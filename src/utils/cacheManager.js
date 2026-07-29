// File: src/utils/cacheManager.js
//
// Genshare cache substitution layer.
//
// When genshare-service reports a cache hit (via the `cache` block in its
// response), snapshot-api checks its own local cache prefix on S3
// (`<folder>/_cache/<cache_key>/`). If a canonical response has been saved
// there — typically as the result of a curator patch applied via
// snapshot-s3-manager — we substitute its payload for the one genshare
// returned. Subsequent requests for the same PDF therefore benefit from
// human-curated fixes without needing to hit genshare again.
//
// This module is the single place that knows about the cache S3 layout,
// the config toggles (`genshare.cache.*`), and the audit log format.

const {
  uploadBatchToS3,
  getFile,
  deleteObjectsByPrefix,
  s3Config
} = require('./s3Storage');
const dbManager = require('./dbManager');
const { watchConfig } = require('./configWatcher');
const config = require('../config');
const { logger } = require('./logger');

const genshareConfig = watchConfig(config.genshareConfigPath);

const DEFAULTS = {
  enabled: false,
  ttlAfterZeroConsumersMs: 48 * 60 * 60 * 1000,
  gcIntervalMs: 60 * 60 * 1000,
  s3Prefix: '_cache',
  patchHistoryLimit: 0
};

/**
 * Look up a raw `cache` block in conf/genshare.json. Resolution order:
 *   1. `versions[versionAlias].cache` — the per-version block (preferred)
 *   2. `versions[defaultVersion].cache` — fallback for callers without a version
 *   3. top-level `cache` — legacy/simple layout
 * Returns an empty object when none of the above are present.
 */
const resolveRawCacheBlock = (versionAlias) => {
  const versions = (genshareConfig && genshareConfig.versions) || {};

  if (versionAlias && versions[versionAlias] && versions[versionAlias].cache) {
    return versions[versionAlias].cache;
  }
  const defaultVersion = genshareConfig && genshareConfig.defaultVersion;
  if (defaultVersion && versions[defaultVersion] && versions[defaultVersion].cache) {
    return versions[defaultVersion].cache;
  }
  if (genshareConfig && genshareConfig.cache) {
    return genshareConfig.cache;
  }
  return {};
};

/**
 * Merge a raw cache block with defaults and return the effective config.
 * Pass a genshare version alias to get the version-specific config;
 * omit it to get the deployment-wide defaults (used by the GC worker).
 */
const getCacheConfig = (versionAlias = null) => {
  const raw = resolveRawCacheBlock(versionAlias);
  return {
    enabled: raw.enabled === true,
    ttlAfterZeroConsumersMs:
      typeof raw.ttlAfterZeroConsumersMs === 'number' && raw.ttlAfterZeroConsumersMs >= 0
        ? raw.ttlAfterZeroConsumersMs
        : DEFAULTS.ttlAfterZeroConsumersMs,
    gcIntervalMs:
      typeof raw.gcIntervalMs === 'number' && raw.gcIntervalMs > 0
        ? raw.gcIntervalMs
        : DEFAULTS.gcIntervalMs,
    s3Prefix: typeof raw.s3Prefix === 'string' && raw.s3Prefix ? raw.s3Prefix : DEFAULTS.s3Prefix,
    patchHistoryLimit:
      typeof raw.patchHistoryLimit === 'number' && raw.patchHistoryLimit >= 0
        ? raw.patchHistoryLimit
        : DEFAULTS.patchHistoryLimit
  };
};

/**
 * True if *any* version has cache enabled, or (failing that) if the legacy
 * top-level cache block has it enabled. Used by the GC worker to decide
 * whether to start.
 */
const isCacheGloballyEnabled = () => {
  const versions = (genshareConfig && genshareConfig.versions) || {};
  for (const key of Object.keys(versions)) {
    if (versions[key] && versions[key].cache && versions[key].cache.enabled === true) {
      return true;
    }
  }
  return genshareConfig && genshareConfig.cache && genshareConfig.cache.enabled === true;
};

const isCacheEnabled = (versionAlias = null) => getCacheConfig(versionAlias).enabled === true;

// -------------------------------------------------------------------------
// S3 key helpers
// -------------------------------------------------------------------------

const cacheBasePath = (cacheKey) =>
  `${s3Config.s3Folder}/${getCacheConfig(null).s3Prefix}/${cacheKey}`;

const requestBasePath = (userId, requestId) =>
  `${s3Config.s3Folder}/${userId}/${requestId}`;

// -------------------------------------------------------------------------
// Read helpers (S3)
// -------------------------------------------------------------------------

const tryGetJson = async (key) => {
  try {
    const raw = await getFile(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (error) {
    if (error.$metadata?.httpStatusCode === 404 || error.name === 'NoSuchKey') {
      return null;
    }
    logger.error(`[cache] Error reading ${key}: ${error.message}`);
    return null;
  }
};

const tryGetText = async (key) => {
  try {
    const raw = await getFile(key);
    return raw || '';
  } catch (error) {
    if (error.$metadata?.httpStatusCode === 404 || error.name === 'NoSuchKey') {
      return '';
    }
    logger.error(`[cache] Error reading ${key}: ${error.message}`);
    return '';
  }
};

/**
 * Read the current canonical cached response array.
 * @returns {Promise<Array|null>} the `response` array or null when no cache entry
 */
const readCacheResponseArray = async (cacheKey) => {
  const data = await tryGetJson(`${cacheBasePath(cacheKey)}/response.json`);
  if (!data || !Array.isArray(data.response)) return null;
  return data.response;
};

/**
 * Read the immutable full original genshare payload for a cache key.
 * @returns {Promise<Object|null>}
 */
const readCacheOriginal = async (cacheKey) =>
  tryGetJson(`${cacheBasePath(cacheKey)}/original.json`);

/**
 * Read the meta.json of a cache entry.
 * @returns {Promise<Object|null>}
 */
const readCacheMeta = async (cacheKey) =>
  tryGetJson(`${cacheBasePath(cacheKey)}/meta.json`);

/**
 * Read the full patches.ndjson audit log (newest last).
 * @returns {Promise<Array>} parsed entries or []
 */
const readCachePatches = async (cacheKey) => {
  const text = await tryGetText(`${cacheBasePath(cacheKey)}/patches.ndjson`);
  if (!text) return [];
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
};

// -------------------------------------------------------------------------
// Write helpers (S3 via the existing batch uploader)
// -------------------------------------------------------------------------

const putText = async (key, text, contentType = 'text/plain') => {
  await uploadBatchToS3([{ key, data: text, contentType }]);
};

/**
 * Create (or refresh) the shared cache entry artifacts for a new cache key.
 * - `original.json` is written only if it doesn't already exist.
 * - `response.json` is written only if it doesn't already exist
 *   (never clobber a curator's patched version).
 * - `meta.json` always reflects the latest metadata we know.
 *
 * @param {string} cacheKey
 * @param {Object} fullPayload - the entire genshare response.data JSON
 * @param {Object} meta - { pdf_hash, supplementary_hash, graph_slug, graph_version }
 */
const seedCacheEntry = async (cacheKey, fullPayload, meta) => {
  const base = cacheBasePath(cacheKey);

  const [existingOriginal, existingResponse, existingMeta] = await Promise.all([
    tryGetJson(`${base}/original.json`),
    tryGetJson(`${base}/response.json`),
    tryGetJson(`${base}/meta.json`)
  ]);

  const uploads = [];

  if (!existingOriginal) {
    uploads.push({
      key: `${base}/original.json`,
      data: JSON.stringify(fullPayload, null, 2),
      contentType: 'application/json'
    });
  }

  if (!existingResponse) {
    uploads.push({
      key: `${base}/response.json`,
      data: JSON.stringify(
        { response: Array.isArray(fullPayload.response) ? fullPayload.response : [] },
        null,
        2
      ),
      contentType: 'application/json'
    });
  }

  const nextMeta = {
    pdf_hash: meta.pdf_hash || '',
    supplementary_hash: meta.supplementary_hash || null,
    graph_slug: meta.graph_slug || '',
    graph_version: meta.graph_version || '',
    created_at: existingMeta?.created_at || new Date().toISOString(),
    last_patched_at: existingMeta?.last_patched_at || null,
    ttl_expires_at: null
  };

  uploads.push({
    key: `${base}/meta.json`,
    data: JSON.stringify(nextMeta, null, 2),
    contentType: 'application/json'
  });

  if (uploads.length > 0) {
    await uploadBatchToS3(uploads);
  }
};

/**
 * Overwrite the canonical cache response.json with a new `response` array.
 * Updates meta.last_patched_at and appends an entry to patches.ndjson.
 *
 * @param {string} cacheKey
 * @param {Array}  responseArray - the new response[] items
 * @param {Object} audit - { actor, reason?, propagated_to?, summary? }
 */
const patchCacheResponse = async (cacheKey, responseArray, audit = {}) => {
  if (!Array.isArray(responseArray)) {
    throw new Error('patchCacheResponse: responseArray must be an array');
  }
  const base = cacheBasePath(cacheKey);
  const now = new Date().toISOString();

  const [existingMeta, existingPatches] = await Promise.all([
    readCacheMeta(cacheKey),
    tryGetText(`${base}/patches.ndjson`)
  ]);

  if (!existingMeta) {
    throw new Error(`patchCacheResponse: no meta.json for cache_key=${cacheKey}`);
  }

  const nextMeta = {
    ...existingMeta,
    last_patched_at: now,
    ttl_expires_at: null
  };

  const patchEntry = {
    ts: now,
    actor: audit.actor || 'unknown',
    reason: audit.reason || null,
    propagated_to: Array.isArray(audit.propagated_to) ? audit.propagated_to : [],
    summary: audit.summary || { items: responseArray.length }
  };

  const nextPatches = (existingPatches ? existingPatches.trimEnd() + '\n' : '') +
    JSON.stringify(patchEntry) + '\n';

  await uploadBatchToS3([
    {
      key: `${base}/response.json`,
      data: JSON.stringify({ response: responseArray }, null, 2),
      contentType: 'application/json'
    },
    {
      key: `${base}/meta.json`,
      data: JSON.stringify(nextMeta, null, 2),
      contentType: 'application/json'
    },
    {
      key: `${base}/patches.ndjson`,
      data: nextPatches,
      contentType: 'application/x-ndjson'
    }
  ]);

  await dbManager.touchCacheEntryPatched(cacheKey);

  return { last_patched_at: now };
};

/**
 * Append a single entry to the patches.ndjson audit log without touching
 * response.json or meta.json. Used by the propagate-only flow when the curator
 * chose not to mutate the shared response but did update individual requests.
 */
const appendPatchLog = async (cacheKey, entry) => {
  const base = cacheBasePath(cacheKey);
  const existing = await tryGetText(`${base}/patches.ndjson`);
  const payload = (existing ? existing.trimEnd() + '\n' : '') +
    JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n';
  await putText(`${base}/patches.ndjson`, payload, 'application/x-ndjson');
};

/**
 * Overwrite a single request's genshare/response.json with a new slim payload.
 * Used by PATCH /cache/:cache_key when the curator asks to propagate the new
 * response to selected consumers. Leaves response.json / response.original.json
 * / genshare/response.original.json untouched.
 *
 * Also refreshes that request's cache-ref.json `patched_at`.
 */
const propagateResponseToRequest = async (userId, requestId, responseArray) => {
  const base = requestBasePath(userId, requestId);
  const refKey = `${base}/cache-ref.json`;
  const ref = (await tryGetJson(refKey)) || {};
  const nextRef = {
    ...ref,
    patched_at: new Date().toISOString()
  };
  await uploadBatchToS3([
    {
      key: `${base}/genshare/response.json`,
      data: JSON.stringify({ response: responseArray }, null, 2),
      contentType: 'application/json'
    },
    {
      key: refKey,
      data: JSON.stringify(nextRef, null, 2),
      contentType: 'application/json'
    }
  ]);
};

/**
 * Delete the entire _cache/<cache_key>/ prefix from S3 and the DB row.
 */
const deleteCacheEntry = async (cacheKey) => {
  const base = cacheBasePath(cacheKey);
  await deleteObjectsByPrefix(base);
  await dbManager.deleteCacheEntry(cacheKey);
};

// -------------------------------------------------------------------------
// Orchestration — called by genshareManager.processPDF
// -------------------------------------------------------------------------

/**
 * Apply the cache layer around a genshare response.
 *
 * Behaviour:
 *   - If cache disabled → returns { applied: false }, no side-effects.
 *   - Otherwise:
 *       1. Seed (or refresh) the shared cache entry for this cache_key using
 *          the raw genshare payload as the original+current source.
 *       2. If we already had a patched canonical, substitute the `response`
 *          array in-place on the passed-in payload so downstream code uses it.
 *       3. Upsert the cache_entries row and clear TTL.
 *   - Always returns a cache-ref object so the caller can attach it to the
 *     session (and thereby save it alongside the request in S3).
 *
 * @param {Object} responseData - the full genshare response.data (mutated in place when substituting)
 * @returns {Promise<{applied:boolean, cacheKey:string?, cacheRef:Object?, substituted:boolean}>}
 */
const applyCacheToGenshareResponse = async (responseData, versionAlias = null, session = null) => {
  // Helper: write to session.process.log when a session is provided, and
  // mirror to the Winston logger (combined.log) for operator visibility.
  const sessionLog = (message, level = 'INFO') => {
    if (session && typeof session.addLog === 'function') {
      session.addLog(`[cache] ${message}`, level);
    }
    if (level === 'WARN') {
      logger.warn(`[cache] ${message}`);
    } else if (level === 'ERROR') {
      logger.error(`[cache] ${message}`);
    } else {
      logger.info(`[cache] ${message}`);
    }
  };

  if (!isCacheEnabled(versionAlias)) {
    const reason = versionAlias
      ? `cache_disabled_for_version:${versionAlias}`
      : 'cache_disabled';
    sessionLog(`Skipping — ${reason}`);
    return {
      applied: false,
      cacheKey: null,
      cacheRef: null,
      substituted: false,
      skipReason: reason
    };
  }

  const cacheBlock = responseData && responseData.cache;
  if (!cacheBlock || !cacheBlock.key) {
    const reason = !cacheBlock
      ? 'no_cache_block_in_genshare_response'
      : 'cache_block_missing_key';
    sessionLog(`Skipping — ${reason}`);
    return {
      applied: false,
      cacheKey: null,
      cacheRef: null,
      substituted: false,
      skipReason: reason
    };
  }

  const cacheKey = cacheBlock.key;
  const cacheHit = cacheBlock.hit === true;
  const now = new Date().toISOString();

  sessionLog(
    `GenShare reported cache.hit=${cacheHit} key=${cacheKey} ` +
      `(pdf_hash=${cacheBlock.pdf_hash || 'n/a'}, graph=${cacheBlock.graph_slug || 'n/a'}/${cacheBlock.graph_version || 'n/a'})`
  );

  let cachedResponseArray = null;
  let substituted = false;

  sessionLog(`Checking local cache for key ${cacheKey}`);
  try {
    cachedResponseArray = await readCacheResponseArray(cacheKey);
  } catch (error) {
    sessionLog(`readCacheResponseArray failed: ${error.message}`, 'ERROR');
  }

  if (cachedResponseArray && Array.isArray(responseData.response)) {
    const before = responseData.response.length;
    responseData.response = cachedResponseArray;
    substituted = true;
    sessionLog(
      `Local cache hit — substituted response array ` +
        `(from ${before} items returned by genshare to ${cachedResponseArray.length} items in local cache)`
    );
  } else if (cachedResponseArray) {
    sessionLog(
      `Local cache hit but genshare response has no response[] to substitute — keeping local cache read-only`,
      'WARN'
    );
  } else {
    sessionLog(`Local cache miss — will seed a new entry`);
  }

  // Seed or refresh the shared cache entry. When a patched canonical already
  // exists, seedCacheEntry is a no-op for response.json (never clobbers).
  try {
    await seedCacheEntry(cacheKey, responseData, {
      pdf_hash: cacheBlock.pdf_hash || '',
      supplementary_hash: cacheBlock.supplementary_hash || null,
      graph_slug: cacheBlock.graph_slug || '',
      graph_version: cacheBlock.graph_version || ''
    });
    sessionLog(
      substituted
        ? `Seed pass: refreshed meta.json for ${cacheKey} (response.json left untouched — it's patched)`
        : `Seed pass: wrote original.json + response.json + meta.json for ${cacheKey}`
    );
  } catch (error) {
    sessionLog(`seedCacheEntry failed for ${cacheKey}: ${error.message}`, 'ERROR');
  }

  try {
    await dbManager.upsertCacheEntry({
      cacheKey,
      pdfHash: cacheBlock.pdf_hash || '',
      supplementaryHash: cacheBlock.supplementary_hash || null,
      graphSlug: cacheBlock.graph_slug || '',
      graphVersion: cacheBlock.graph_version || ''
    });
    sessionLog(`Upserted cache_entries row for ${cacheKey}`);
  } catch (error) {
    sessionLog(`upsertCacheEntry failed for ${cacheKey}: ${error.message}`, 'ERROR');
  }

  let patchedAt = null;
  if (substituted) {
    const meta = await readCacheMeta(cacheKey);
    patchedAt = meta?.last_patched_at || null;
    if (patchedAt) sessionLog(`Canonical was last patched at ${patchedAt}`);
  }

  const cacheRef = {
    cache_key: cacheKey,
    cache_hit: cacheHit,
    cache_substituted: substituted,
    applied_at: now,
    patched_at: patchedAt
  };

  return {
    applied: true,
    cacheKey,
    cacheRef,
    substituted
  };
};

module.exports = {
  isCacheEnabled,
  isCacheGloballyEnabled,
  getCacheConfig,
  cacheBasePath,
  applyCacheToGenshareResponse,
  // Read-side helpers used by the cache controller
  readCacheResponseArray,
  readCacheOriginal,
  readCacheMeta,
  readCachePatches,
  // Write-side helpers used by the cache controller
  seedCacheEntry,
  patchCacheResponse,
  appendPatchLog,
  propagateResponseToRequest,
  deleteCacheEntry
};
