// File: src/utils/configWatcher.js
const fs = require('fs');
const path = require('path');
const { logger } = require('./logger');

/**
 * Registry of watched config files.
 * Key: resolved file path, Value: { proxy, getData }
 */
const watched = new Map();

/** Debounce delay (ms) to avoid duplicate fs.watch events */
const DEBOUNCE_MS = 100;

/**
 * Watch a JSON config file and return a Proxy that always reflects the latest content.
 * The file is read once at startup, then re-read only when fs.watch detects a change.
 * Multiple calls with the same path return the same Proxy instance.
 *
 * @param {string} configPath - Absolute path to the JSON config file
 * @param {Object} [defaultValue={}] - Default value if the file does not exist
 * @returns {Proxy} A read-only proxy that transparently reflects the current file content
 */
const watchConfig = (configPath, defaultValue = {}) => {
  // Deduplicate by resolved path
  const resolved = path.resolve(configPath);

  if (watched.has(resolved)) {
    return watched.get(resolved).proxy;
  }

  let data;

  /**
   * (Re)read the file into `data`. On failure, keeps the previous content (or
   * the default on first load) so a bad write never wipes the in-memory config.
   * @param {boolean} isInitial - True for the startup load (quieter logging)
   * @returns {boolean} True if the file was read and parsed successfully
   */
  const reload = (isInitial = false) => {
    try {
      data = JSON.parse(fs.readFileSync(resolved, 'utf8'));
      if (!isInitial) {
        logger.info(`[ConfigWatcher] Reloaded ${path.basename(resolved)}`);
      }
      return true;
    } catch (error) {
      if (isInitial) {
        logger.warn(`[ConfigWatcher] ${path.basename(resolved)} not found or invalid, using defaults`);
        data = defaultValue;
      } else {
        logger.error(`[ConfigWatcher] Failed to reload ${path.basename(resolved)}: ${error.message}`);
        // Keep previous data on error
      }
      return false;
    }
  };

  // Initial load
  reload(true);

  // Set up file watcher with debounce (handles edits made outside this process)
  let debounceTimer = null;
  try {
    fs.watch(resolved, () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => reload(false), DEBOUNCE_MS);
    });
  } catch (watchError) {
    logger.warn(`[ConfigWatcher] Could not watch ${path.basename(resolved)}: ${watchError.message}`);
  }

  // Create a Proxy that transparently forwards property access to the current data
  const proxy = new Proxy({}, {
    get: (_, prop) => data[prop],
    has: (_, prop) => prop in data,
    ownKeys: () => Reflect.ownKeys(data),
    getOwnPropertyDescriptor: (_, prop) => {
      if (prop in data) {
        return { configurable: true, enumerable: true, value: data[prop], writable: false };
      }
    }
  });

  watched.set(resolved, { proxy, reload });

  return proxy;
};

/**
 * Force a synchronous re-read of a watched config file.
 *
 * fs.watch fires asynchronously (plus a debounce), so a process that writes a
 * watched file and then reads it back through the proxy would observe stale
 * data until the watcher catches up. Writers should call this immediately after
 * writing so subsequent reads in the same process are consistent. No-op if the
 * path is not currently being watched.
 * @param {string} configPath - The path passed to watchConfig
 * @returns {boolean} True if the file was reloaded successfully
 */
const reloadConfig = (configPath) => {
  const entry = watched.get(path.resolve(configPath));
  if (entry && typeof entry.reload === 'function') {
    return entry.reload(false);
  }
  return false;
};

module.exports = { watchConfig, reloadConfig };
