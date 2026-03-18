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

  // Initial load
  let data;
  try {
    data = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  } catch (error) {
    logger.warn(`[ConfigWatcher] ${path.basename(resolved)} not found or invalid, using defaults`);
    data = defaultValue;
  }

  // Set up file watcher with debounce
  let debounceTimer = null;
  try {
    fs.watch(resolved, () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        try {
          data = JSON.parse(fs.readFileSync(resolved, 'utf8'));
          logger.info(`[ConfigWatcher] Reloaded ${path.basename(resolved)}`);
        } catch (err) {
          logger.error(`[ConfigWatcher] Failed to reload ${path.basename(resolved)}: ${err.message}`);
          // Keep previous data on error
        }
      }, DEBOUNCE_MS);
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

  watched.set(resolved, { proxy });

  return proxy;
};

module.exports = { watchConfig };
