// File: src/controllers/cacheController.js
//
// HTTP surface for the genshare cache layer. Exposed under
// `/snapshot-s3-manager/cache/*` so the snapshot-s3-manager tool (and admins)
// can browse, inspect, patch, and delete shared cache entries.

const cacheManager = require('../utils/cacheManager');
const dbManager = require('../utils/dbManager');
const { logger } = require('../utils/logger');

/**
 * Guardrail: if the cache layer is disabled in config, all endpoints respond
 * with 503 to make the misconfiguration obvious instead of silently listing
 * an empty set.
 */
const requireCacheEnabled = (req, res) => {
  if (!cacheManager.isCacheEnabled()) {
    res.status(503).json({
      success: false,
      error: 'Cache layer is disabled (genshare.cache.enabled === false)'
    });
    return false;
  }
  return true;
};

/**
 * GET /snapshot-s3-manager/cache
 * List every cache entry with its live consumer count.
 */
const listCacheEntries = async (req, res) => {
  if (!requireCacheEnabled(req, res)) return;
  try {
    const rows = await dbManager.listCacheEntriesWithCounts();
    res.json({
      success: true,
      entries: rows.map((r) => ({
        cache_key: r.cache_key,
        pdf_hash: r.pdf_hash,
        supplementary_hash: r.supplementary_hash,
        graph_slug: r.graph_slug,
        graph_version: r.graph_version,
        consumer_count: r.consumer_count || 0,
        created_at: r.created_at,
        last_patched_at: r.last_patched_at,
        ttl_expires_at: r.ttl_expires_at
      }))
    });
  } catch (error) {
    logger.error(`[cache] listCacheEntries failed: ${error.message}`);
    res.status(500).json({ success: false, error: 'Failed to list cache entries' });
  }
};

/**
 * GET /snapshot-s3-manager/cache/:cache_key
 * Detail view: meta + current canonical response + full patch history + consumers.
 * Does NOT include the full original payload — use the /original endpoint for that.
 */
const getCacheEntry = async (req, res) => {
  if (!requireCacheEnabled(req, res)) return;
  const { cache_key: cacheKey } = req.params;
  if (!cacheKey) {
    res.status(400).json({ success: false, error: 'cache_key is required' });
    return;
  }
  try {
    const [meta, responseBlob, patches, consumers] = await Promise.all([
      cacheManager.readCacheMeta(cacheKey),
      (async () => {
        const arr = await cacheManager.readCacheResponseArray(cacheKey);
        return arr ? { response: arr } : null;
      })(),
      cacheManager.readCachePatches(cacheKey),
      dbManager.listCacheConsumers(cacheKey)
    ]);

    if (!meta) {
      res.status(404).json({ success: false, error: 'Cache entry not found' });
      return;
    }

    res.json({
      success: true,
      meta,
      response: responseBlob,
      patches,
      consumers
    });
  } catch (error) {
    logger.error(`[cache] getCacheEntry failed for ${cacheKey}: ${error.message}`);
    res.status(500).json({ success: false, error: 'Failed to get cache entry' });
  }
};

/**
 * GET /snapshot-s3-manager/cache/:cache_key/original
 * Returns the immutable original.json full genshare payload (potentially large;
 * fetched on-demand so the detail view stays small).
 */
const getCacheEntryOriginal = async (req, res) => {
  if (!requireCacheEnabled(req, res)) return;
  const { cache_key: cacheKey } = req.params;
  if (!cacheKey) {
    res.status(400).json({ success: false, error: 'cache_key is required' });
    return;
  }
  try {
    const original = await cacheManager.readCacheOriginal(cacheKey);
    if (!original) {
      res.status(404).json({ success: false, error: 'Original payload not found' });
      return;
    }
    res.json({ success: true, original });
  } catch (error) {
    logger.error(`[cache] getCacheEntryOriginal failed for ${cacheKey}: ${error.message}`);
    res.status(500).json({ success: false, error: 'Failed to get original payload' });
  }
};

/**
 * PATCH /snapshot-s3-manager/cache/:cache_key
 * Body: { response: Array, reason?: string, propagate_to?: string[] }
 * - Writes the shared canonical response + appends to patches.ndjson.
 * - For each requestId in propagate_to, overwrites that request's
 *   genshare/response.json IF its cache_key matches. Mismatches and S3 write
 *   failures are silently skipped and reported in the response.
 */
const patchCacheEntry = async (req, res) => {
  if (!requireCacheEnabled(req, res)) return;
  const { cache_key: cacheKey } = req.params;
  if (!cacheKey) {
    res.status(400).json({
      success: false,
      error: 'cache_key is required',
      skipped: []
    });
    return;
  }

  const { response, reason, propagate_to } = req.body || {};
  if (!Array.isArray(response)) {
    res.status(400).json({
      success: false,
      error: 'Body.response must be an array of { name, description, value } items',
      skipped: []
    });
    return;
  }

  const propagateList = Array.isArray(propagate_to) ? propagate_to : [];
  const actor = req.user?.id || 'unknown';
  const skipped = [];

  // Step 1: write the shared canonical. If this fails, abort (no propagation).
  try {
    const existingMeta = await cacheManager.readCacheMeta(cacheKey);
    if (!existingMeta) {
      res.status(404).json({
        success: false,
        error: 'Cache entry not found',
        skipped: []
      });
      return;
    }

    await cacheManager.patchCacheResponse(cacheKey, response, {
      actor,
      reason: reason || null,
      propagated_to: propagateList,
      summary: { items: response.length }
    });
  } catch (error) {
    logger.error(`[cache] patchCacheEntry canonical write failed for ${cacheKey}: ${error.message}`);
    res.status(500).json({
      success: false,
      error: `Failed to write canonical cache response: ${error.message}`,
      skipped: []
    });
    return;
  }

  // Step 2: propagate to selected consumers. Silent-skip on mismatch.
  for (const requestId of propagateList) {
    if (typeof requestId !== 'string' || !requestId) {
      skipped.push({ request_id: String(requestId), reason: 'invalid_request_id' });
      continue;
    }
    try {
      const ownerUserId = await dbManager.getCacheConsumerOwner(cacheKey, requestId);
      if (!ownerUserId) {
        skipped.push({ request_id: requestId, reason: 'cache_key_mismatch_or_not_found' });
        continue;
      }
      await cacheManager.propagateResponseToRequest(ownerUserId, requestId, response);
    } catch (error) {
      logger.error(`[cache] propagateResponseToRequest failed for ${requestId}: ${error.message}`);
      skipped.push({ request_id: requestId, reason: error.message || 'propagation_failed' });
    }
  }

  res.json({
    success: true,
    error: null,
    skipped
  });
};

/**
 * DELETE /snapshot-s3-manager/cache/:cache_key
 * Admin-only force purge. Leaves per-request `genshare/response.json` files
 * as-is (they stay whatever they were last patched to).
 */
const deleteCacheEntry = async (req, res) => {
  if (!requireCacheEnabled(req, res)) return;
  const { cache_key: cacheKey } = req.params;
  if (!cacheKey) {
    res.status(400).json({ success: false, error: 'cache_key is required' });
    return;
  }
  try {
    await cacheManager.deleteCacheEntry(cacheKey);
    res.json({ success: true });
  } catch (error) {
    logger.error(`[cache] deleteCacheEntry failed for ${cacheKey}: ${error.message}`);
    res.status(500).json({ success: false, error: 'Failed to delete cache entry' });
  }
};

module.exports = {
  listCacheEntries,
  getCacheEntry,
  getCacheEntryOriginal,
  patchCacheEntry,
  deleteCacheEntry
};
