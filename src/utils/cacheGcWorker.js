// File: src/utils/cacheGcWorker.js
//
// Background sweeper for the genshare cache. Walks every `cache_entries` row,
// computes its live consumer count, sets/clears `ttl_expires_at` accordingly,
// and deletes entries whose TTL has elapsed.
//
// The loop is driven by `genshare.cache.gcIntervalMs` and only runs while
// `genshare.cache.enabled === true`. Safe to import unconditionally: `start()`
// becomes a no-op when the feature is disabled.

const dbManager = require('./dbManager');
const cacheManager = require('./cacheManager');
const { logger } = require('./logger');

let timer = null;
let running = false;
let stopped = false;

/**
 * Run one sweep across every cache entry. Exposed for tests and for the
 * startup call that primes the TTL state immediately.
 */
const runOnce = async () => {
  if (!cacheManager.isCacheGloballyEnabled()) return { skipped: 'disabled' };
  if (running) return { skipped: 'already_running' };
  running = true;
  try {
    const { ttlAfterZeroConsumersMs } = cacheManager.getCacheConfig(null);
    const rows = await dbManager.listCacheEntriesWithCounts();
    const now = Date.now();
    let cleared = 0;
    let scheduled = 0;
    let deleted = 0;

    for (const row of rows) {
      const cacheKey = row.cache_key;
      const count = row.consumer_count || 0;
      const ttlExpires = row.ttl_expires_at ? Date.parse(row.ttl_expires_at) : null;

      if (count > 0) {
        if (ttlExpires) {
          await dbManager.setCacheEntryTtl(cacheKey, null);
          cleared += 1;
        }
        continue;
      }

      // count === 0
      if (!ttlExpires) {
        const expiresAt = new Date(now + ttlAfterZeroConsumersMs);
        await dbManager.setCacheEntryTtl(cacheKey, expiresAt);
        scheduled += 1;
        continue;
      }

      if (now >= ttlExpires) {
        try {
          await cacheManager.deleteCacheEntry(cacheKey);
          deleted += 1;
        } catch (error) {
          logger.error(`[cache-gc] Failed to delete expired entry ${cacheKey}: ${error.message}`);
        }
      }
    }

    if (cleared || scheduled || deleted) {
      logger.info(
        `[cache-gc] Sweep: cleared=${cleared} scheduled=${scheduled} deleted=${deleted} ` +
          `(checked ${rows.length})`
      );
    }

    return { cleared, scheduled, deleted, checked: rows.length };
  } catch (error) {
    logger.error(`[cache-gc] Sweep failed: ${error.message}`);
    return { error: error.message };
  } finally {
    running = false;
  }
};

/**
 * Start the recurring GC loop. Safe to call multiple times — second call is
 * a no-op if the timer is already running.
 */
const start = () => {
  const cfg = cacheManager.getCacheConfig(null);
  const globallyEnabled = cacheManager.isCacheGloballyEnabled();
  logger.info(
    `[cache] Effective global config: globallyEnabled=${globallyEnabled} ` +
      `defaultEnabled=${cfg.enabled} ` +
      `ttlAfterZeroConsumersMs=${cfg.ttlAfterZeroConsumersMs} ` +
      `gcIntervalMs=${cfg.gcIntervalMs} s3Prefix=${cfg.s3Prefix}`
  );
  if (!globallyEnabled) {
    logger.info(
      '[cache-gc] No genshare version has cache.enabled=true in conf/genshare.json; GC worker not started'
    );
    return;
  }
  if (timer) return;
  stopped = false;

  const { gcIntervalMs } = cfg;
  logger.info(`[cache-gc] Starting GC worker (interval ${gcIntervalMs}ms)`);

  // Prime immediately so freshly-started servers reconcile TTLs before the
  // first wall-clock interval elapses.
  runOnce().catch(() => {});

  timer = setInterval(() => {
    if (stopped) return;
    runOnce().catch(() => {});
  }, gcIntervalMs);

  // Node's default is to keep the event loop alive until the timer fires.
  // Unref so SIGINT during dev can still exit cleanly.
  if (typeof timer.unref === 'function') timer.unref();
};

const stop = () => {
  stopped = true;
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
};

module.exports = { start, stop, runOnce };
