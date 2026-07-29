/**
 * Test helper for in-memory SQLite database setup
 * Uses shared-cache mode so all connections share the same DB
 *
 * IMPORTANT: An "anchor" connection must stay open for the entire test run.
 * With file::memory:?cache=shared, the in-memory DB is destroyed once all
 * connections are closed. The anchor connection keeps it alive.
 */

const sqlite3 = require('sqlite3').verbose();

const SHARED_MEMORY_DB = 'file::memory:?cache=shared';

let anchorDb = null;

/**
 * Set up environment for in-memory test database
 * Must be called before requiring dbManager
 */
function setupTestDb() {
  process.env.DB_PATH = SHARED_MEMORY_DB;
}

/**
 * Initialize the test database schema
 * Opens a persistent anchor connection, then runs initDatabase
 * @returns {Promise<void>}
 */
async function initTestDb() {
  // Open anchor connection to keep the shared-cache DB alive
  if (!anchorDb) {
    anchorDb = await new Promise((resolve, reject) => {
      const mode = sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE | sqlite3.OPEN_URI;
      const db = new sqlite3.Database(SHARED_MEMORY_DB, mode, (err) => {
        if (err) reject(err);
        else resolve(db);
      });
    });
  }

  const dbManager = require('../../src/utils/dbManager');
  await dbManager.initDatabase();
}

/**
 * Close the anchor connection and release the in-memory database
 * Call in afterAll to clean up
 * @returns {Promise<void>}
 */
async function closeTestDb() {
  if (anchorDb) {
    await new Promise((resolve, reject) => {
      anchorDb.close((err) => {
        anchorDb = null;
        if (err) reject(err);
        else resolve();
      });
    });
  }
}

module.exports = {
  SHARED_MEMORY_DB,
  setupTestDb,
  initTestDb,
  closeTestDb
};
