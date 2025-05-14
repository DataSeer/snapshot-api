// File: src/utils/dbManager.js
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

// Create sqlite directory if it doesn't exist
const SQLITE_DIR = path.join(__dirname, '../../sqlite');
if (!fs.existsSync(SQLITE_DIR)) {
  fs.mkdirSync(SQLITE_DIR, { recursive: true });
}

const DB_PATH = path.join(SQLITE_DIR, 'snapshot.db');

/**
 * Database connection manager
 * @returns {Promise<sqlite3.Database>} - SQLite database instance
 */
const getDBConnection = () => {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(DB_PATH, (err) => {
      if (err) {
        console.error('Error opening database:', err);
        reject(err);
      } else {
        resolve(db);
      }
    });
  });
};

/**
 * Initialize database schema
 * @returns {Promise<void>}
 */
const initDatabase = async () => {
  try {
    const db = await getDBConnection();
    
    // Create the requests table if it doesn't exist
    await new Promise((resolve, reject) => {
      db.run(`CREATE TABLE IF NOT EXISTS requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_name TEXT NOT NULL,
        article_id TEXT NOT NULL,
        request_id TEXT NOT NULL UNIQUE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`, (err) => {
        if (err) {
          console.error('Error creating requests table:', err);
          reject(err);
        } else {
          resolve();
        }
      });
    });
    
    // Create the temporary_tokens table if it doesn't exist
    await new Promise((resolve, reject) => {
      db.run(`CREATE TABLE IF NOT EXISTS temporary_tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id TEXT NOT NULL,
        token TEXT NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME NOT NULL,
        revoked INTEGER DEFAULT 0,
        UNIQUE(client_id, token)
      )`, (err) => {
        if (err) {
          console.error('Error creating temporary_tokens table:', err);
          reject(err);
        } else {
          resolve();
        }
      });
    });
    
    // Close database connection
    await new Promise((resolve, reject) => {
      db.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    
    console.log('Database initialized successfully');
  } catch (error) {
    console.error('Error initializing database:', error);
    throw error;
  }
};

/*
 * TOKEN MANAGEMENT METHODS
 */

/**
 * Get a valid token for a client
 * @param {string} clientId - The client ID
 * @returns {Promise<Object|null>} - Token record or null if not found
 */
const getValidToken = async (clientId) => {
  try {
    const db = await getDBConnection();
    const now = new Date().toISOString();
    
    const result = await new Promise((resolve, reject) => {
      db.get(
        `SELECT * FROM temporary_tokens 
         WHERE client_id = ? 
         AND expires_at > ? 
         AND revoked = 0 
         ORDER BY created_at DESC 
         LIMIT 1`,
        [clientId, now],
        (err, row) => {
          if (err) reject(err);
          else resolve(row || null);
        }
      );
    });
    
    await new Promise((resolve, reject) => {
      db.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    
    return result;
  } catch (error) {
    console.error('Error getting valid token:', error);
    throw error;
  }
};

/**
 * Store a new token in the database
 * @param {string} clientId - The client ID
 * @param {string} token - The JWT token
 * @param {Date} expiresAt - Token expiration date
 * @returns {Promise<number>} - ID of the inserted record
 */
const storeToken = async (clientId, token, expiresAt) => {
  try {
    const db = await getDBConnection();
    
    const result = await new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO temporary_tokens (client_id, token, expires_at) 
         VALUES (?, ?, ?)`,
        [clientId, token, expiresAt.toISOString()],
        function(err) {
          if (err) reject(err);
          else resolve(this.lastID);
        }
      );
    });
    
    await new Promise((resolve, reject) => {
      db.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    
    return result;
  } catch (error) {
    console.error('Error storing token:', error);
    throw error;
  }
};

/**
 * Revoke a specific token
 * @param {string} token - The token to revoke
 * @returns {Promise<boolean>} - True if token was found and revoked
 */
const revokeToken = async (token) => {
  try {
    const db = await getDBConnection();
    
    const result = await new Promise((resolve, reject) => {
      db.run(
        `UPDATE temporary_tokens 
         SET revoked = 1 
         WHERE token = ?`,
        [token],
        function(err) {
          if (err) reject(err);
          else resolve(this.changes > 0);
        }
      );
    });
    
    await new Promise((resolve, reject) => {
      db.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    
    return result;
  } catch (error) {
    console.error('Error revoking token:', error);
    throw error;
  }
};

/**
 * Verify if a temporary token is valid and not revoked
 * @param {string} token - The token to verify
 * @returns {Promise<boolean>} - True if token is valid
 */
const isTokenValid = async (token) => {
  try {
    const db = await getDBConnection();
    const now = new Date().toISOString();
    
    const result = await new Promise((resolve, reject) => {
      db.get(
        `SELECT * FROM temporary_tokens 
         WHERE token = ? 
         AND expires_at > ? 
         AND revoked = 0`,
        [token, now],
        (err, row) => {
          if (err) reject(err);
          else resolve(!!row);
        }
      );
    });
    
    await new Promise((resolve, reject) => {
      db.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    
    return result;
  } catch (error) {
    console.error('Error verifying token:', error);
    throw error;
  }
};

/**
 * Clean up expired and revoked tokens
 * @returns {Promise<number>} - Number of deleted tokens
 */
const cleanupExpiredTokens = async () => {
  try {
    const db = await getDBConnection();
    const now = new Date().toISOString();
    
    const result = await new Promise((resolve, reject) => {
      db.run(
        `DELETE FROM temporary_tokens 
         WHERE expires_at < ? OR revoked = 1`,
        [now],
        function(err) {
          if (err) reject(err);
          else resolve(this.changes);
        }
      );
    });
    
    await new Promise((resolve, reject) => {
      db.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    
    return result;
  } catch (error) {
    console.error('Error cleaning up tokens:', error);
    throw error;
  }
};

/*
 * ARTICLE REQUEST MANAGEMENT METHODS
 */

/**
 * Add or update a request
 * @param {string} userName - The user name
 * @param {string} articleId - The article ID
 * @param {string} requestId - The request ID
 * @param {string|null} lastModified - Last modification date (optional)
 * @returns {Promise<Object>} - Result with changes count
 */
const addOrUpdateRequest = async (userName, articleId, requestId, lastModified = null) => {
  try {
    const db = await getDBConnection();
    
    let sql, params;
    
    if (lastModified) {
      // If lastModified is provided, update the created_at field as well
      sql = 'INSERT OR REPLACE INTO requests (user_name, article_id, request_id, created_at) VALUES (?, ?, ?, ?)';
      params = [userName, articleId, requestId, lastModified];
    } else {
      // Original implementation without specifying the date
      sql = 'INSERT OR REPLACE INTO requests (user_name, article_id, request_id) VALUES (?, ?, ?)';
      params = [userName, articleId, requestId];
    }
    
    const result = await new Promise((resolve, reject) => {
      db.run(sql, params, function(err) {
        if (err) reject(err);
        else resolve({ changes: this.changes });
      });
    });
    
    await new Promise((resolve, reject) => {
      db.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    
    return result;
  } catch (error) {
    console.error('Error adding/updating request:', error);
    throw error;
  }
};

/**
 * Delete a request
 * @param {string} userName - The user name
 * @param {string} articleId - The article ID
 * @param {string|null} requestId - The request ID (optional)
 * @returns {Promise<Object>} - Result with changes count
 */
const deleteRequest = async (userName, articleId, requestId = null) => {
  try {
    const db = await getDBConnection();
    
    let sql, params;
    
    if (requestId) {
      // If requestId is provided, it's a simple primary key delete
      sql = 'DELETE FROM requests WHERE request_id = ?';
      params = [requestId];
    } else {
      // If only article_id is provided, delete all requests for this article and user
      sql = 'DELETE FROM requests WHERE user_name = ? AND article_id = ?';
      params = [userName, articleId];
    }
    
    const result = await new Promise((resolve, reject) => {
      db.run(sql, params, function(err) {
        if (err) reject(err);
        else resolve({ changes: this.changes });
      });
    });
    
    await new Promise((resolve, reject) => {
      db.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    
    return result;
  } catch (error) {
    console.error('Error deleting request:', error);
    throw error;
  }
};

/**
 * Get request_id for a given article_id (return the newest one)
 * @param {string} userName - The user name
 * @param {string} articleId - The article ID
 * @returns {Promise<string|null>} - The request ID or null if not found
 */
const getRequestIdByArticleId = async (userName, articleId) => {
  try {
    const db = await getDBConnection();
    
    // Added ORDER BY created_at DESC to get the newest request
    const result = await new Promise((resolve, reject) => {
      db.get(
        'SELECT request_id FROM requests WHERE user_name = ? AND article_id = ? ORDER BY created_at DESC LIMIT 1',
        [userName, articleId],
        (err, row) => {
          if (err) reject(err);
          else resolve(row ? row.request_id : null);
        }
      );
    });
    
    await new Promise((resolve, reject) => {
      db.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    
    return result;
  } catch (error) {
    console.error('Error getting request_id by article_id:', error);
    throw error;
  }
};

/**
 * Get article_id for a given request_id
 * @param {string} userName - The user name
 * @param {string} requestId - The request ID
 * @returns {Promise<string|null>} - The article ID or null if not found
 */
const getArticleIdByRequestId = async (userName, requestId) => {
  try {
    const db = await getDBConnection();
    
    const result = await new Promise((resolve, reject) => {
      db.get(
        'SELECT article_id FROM requests WHERE user_name = ? AND request_id = ?',
        [userName, requestId],
        (err, row) => {
          if (err) reject(err);
          else resolve(row ? row.article_id : null);
        }
      );
    });
    
    await new Promise((resolve, reject) => {
      db.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    
    return result;
  } catch (error) {
    console.error('Error getting article_id by request_id:', error);
    throw error;
  }
};

/**
 * Get all request_ids for a given article_id (ordered by newest first)
 * @param {string} userName - The user name
 * @param {string} articleId - The article ID
 * @returns {Promise<string[]>} - Array of request IDs
 */
const getRequestIdsByArticleId = async (userName, articleId) => {
  try {
    const db = await getDBConnection();
    
    // Added ORDER BY created_at DESC to get newest requests first
    const result = await new Promise((resolve, reject) => {
      db.all(
        'SELECT request_id FROM requests WHERE user_name = ? AND article_id = ? ORDER BY created_at DESC',
        [userName, articleId],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows ? rows.map(row => row.request_id) : []);
        }
      );
    });
    
    await new Promise((resolve, reject) => {
      db.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    
    return result;
  } catch (error) {
    console.error('Error getting request_ids by article_id:', error);
    throw error;
  }
};

module.exports = {
  initDatabase,
  
  // Token management methods
  getValidToken,
  storeToken,
  revokeToken,
  isTokenValid,
  cleanupExpiredTokens,
  
  // Article request management methods
  addOrUpdateRequest,
  deleteRequest,
  getRequestIdByArticleId,
  getArticleIdByRequestId,
  getRequestIdsByArticleId
};
