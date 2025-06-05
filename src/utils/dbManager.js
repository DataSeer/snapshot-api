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
    
    // Create the updated requests table with report data
    await new Promise((resolve, reject) => {
      db.run(`CREATE TABLE IF NOT EXISTS requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_name TEXT NOT NULL,
        article_id TEXT NOT NULL,
        request_id TEXT NOT NULL UNIQUE,
        report_data TEXT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`, (err) => {
        if (err) {
          console.error('Error creating requests table:', err);
          reject(err);
        } else {
          resolve();
        }
      });
    });
    
    // Create index for better performance
    await new Promise((resolve, reject) => {
      db.run(`CREATE INDEX IF NOT EXISTS idx_requests_user_article 
              ON requests(user_name, article_id)`, (err) => {
        if (err) {
          console.error('Error creating index:', err);
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
    
    // Create the editorial-manager-submissions table if it doesn't exist
    await new Promise((resolve, reject) => {
      db.run(`CREATE TABLE IF NOT EXISTS "editorial-manager-submissions" (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        request_id TEXT NOT NULL UNIQUE,
        service_id TEXT NOT NULL,
        publication_code TEXT NOT NULL,
        document_id TEXT NOT NULL,
        canceled_at DATETIME DEFAULT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`, (err) => {
        if (err) {
          console.error('Error creating editorial-manager-submissions table:', err);
          reject(err);
        } else {
          resolve();
        }
      });
    });
    
    // Create the processing_jobs table if it doesn't exist
    await new Promise((resolve, reject) => {
      db.run(`CREATE TABLE IF NOT EXISTS processing_jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        request_id TEXT NOT NULL UNIQUE,
        job_type TEXT NOT NULL,
        status TEXT NOT NULL,
        priority INTEGER DEFAULT 5,
        data TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        retries INTEGER DEFAULT 0,
        max_retries INTEGER DEFAULT 3,
        error_message TEXT,
        completion_data TEXT
      )`, (err) => {
        if (err) {
          console.error('Error creating processing_jobs table:', err);
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
 * REQUEST AND REPORT MANAGEMENT METHODS
 */

/**
 * Add or update a request with optional report data
 * @param {string} userName - The user name
 * @param {string} articleId - The article ID
 * @param {string} requestId - The request ID
 * @param {Object|null} reportData - The report data (optional)
 * @param {string|null} lastModified - Last modification date (optional)
 * @returns {Promise<Object>} - Result with changes count
 */
const addOrUpdateRequest = async (userName, articleId, requestId, reportData = null, lastModified = null) => {
  try {
    const db = await getDBConnection();
    
    let sql, params;
    const now = new Date().toISOString();
    
    // Check if record exists
    const existingRecord = await new Promise((resolve, reject) => {
      db.get(
        'SELECT * FROM requests WHERE request_id = ?',
        [requestId],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });
    
    if (existingRecord) {
      // Update existing record
      if (reportData !== null) {
        // Update with report data
        sql = `UPDATE requests 
               SET user_name = ?, article_id = ?, report_data = ?, updated_at = ?
               WHERE request_id = ?`;
        params = [userName, articleId, JSON.stringify(reportData), now, requestId];
      } else if (lastModified) {
        // Update with lastModified date
        sql = `UPDATE requests 
               SET user_name = ?, article_id = ?, created_at = ?, updated_at = ?
               WHERE request_id = ?`;
        params = [userName, articleId, lastModified, now, requestId];
      } else {
        // Simple update
        sql = `UPDATE requests 
               SET user_name = ?, article_id = ?, updated_at = ?
               WHERE request_id = ?`;
        params = [userName, articleId, now, requestId];
      }
    } else {
      // Insert new record
      if (reportData !== null) {
        sql = `INSERT INTO requests (user_name, article_id, request_id, report_data, created_at, updated_at) 
               VALUES (?, ?, ?, ?, ?, ?)`;
        params = [userName, articleId, requestId, JSON.stringify(reportData), lastModified || now, now];
      } else if (lastModified) {
        sql = `INSERT INTO requests (user_name, article_id, request_id, created_at, updated_at) 
               VALUES (?, ?, ?, ?, ?)`;
        params = [userName, articleId, requestId, lastModified, now];
      } else {
        sql = `INSERT INTO requests (user_name, article_id, request_id, created_at, updated_at) 
               VALUES (?, ?, ?, ?, ?)`;
        params = [userName, articleId, requestId, now, now];
      }
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
 * Update report data for a request
 * @param {string} requestId - The request ID
 * @param {Object} reportData - The report data
 * @returns {Promise<boolean>} - True if update was successful
 */
const updateRequestReportData = async (requestId, reportData) => {
  try {
    const db = await getDBConnection();
    const now = new Date().toISOString();
    
    const result = await new Promise((resolve, reject) => {
      db.run(
        `UPDATE requests 
         SET report_data = ?, updated_at = ?
         WHERE request_id = ?`,
        [JSON.stringify(reportData), now, requestId],
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
    console.error('Error updating request report data:', error);
    throw error;
  }
};

/**
 * Get request with report data by request ID (user-specific)
 * @param {string} userName - The user name
 * @param {string} requestId - The request ID
 * @returns {Promise<Object|null>} - Request record with report data or null
 */
const getRequestWithReportData = async (userName, requestId) => {
  try {
    const db = await getDBConnection();
    
    const result = await new Promise((resolve, reject) => {
      db.get(
        `SELECT * FROM requests 
         WHERE user_name = ? AND request_id = ?`,
        [userName, requestId],
        (err, row) => {
          if (err) reject(err);
          else {
            if (row && row.report_data) {
              try {
                row.report_data = JSON.parse(row.report_data);
              } catch (parseError) {
                console.error('Error parsing report data:', parseError);
                row.report_data = null;
              }
            }
            resolve(row || null);
          }
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
    console.error('Error getting request with report data:', error);
    throw error;
  }
};

/**
 * Get request with report data by request ID (cross-user search)
 * @param {string} requestId - The request ID
 * @returns {Promise<Object|null>} - Request record with report data or null
 */
const getRequestWithReportDataAnyUser = async (requestId) => {
  try {
    const db = await getDBConnection();
    
    const result = await new Promise((resolve, reject) => {
      db.get(
        `SELECT * FROM requests 
         WHERE request_id = ?`,
        [requestId],
        (err, row) => {
          if (err) reject(err);
          else {
            if (row && row.report_data) {
              try {
                row.report_data = JSON.parse(row.report_data);
              } catch (parseError) {
                console.error('Error parsing report data:', parseError);
                row.report_data = null;
              }
            }
            resolve(row || null);
          }
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
    console.error('Error getting request with report data (any user):', error);
    throw error;
  }
};

/**
 * Get all requests with report data for a user and article
 * @param {string} userName - The user name
 * @param {string} articleId - The article ID
 * @returns {Promise<Array>} - Array of request records
 */
const getRequestsWithReportDataByArticleId = async (userName, articleId) => {
  try {
    const db = await getDBConnection();
    
    const result = await new Promise((resolve, reject) => {
      db.all(
        `SELECT * FROM requests 
         WHERE user_name = ? AND article_id = ? 
         ORDER BY created_at DESC`,
        [userName, articleId],
        (err, rows) => {
          if (err) reject(err);
          else {
            // Parse report_data for each row
            const parsedRows = rows.map(row => {
              if (row.report_data) {
                try {
                  row.report_data = JSON.parse(row.report_data);
                } catch (parseError) {
                  console.error('Error parsing report data:', parseError);
                  row.report_data = null;
                }
              }
              return row;
            });
            resolve(parsedRows || []);
          }
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
    console.error('Error getting requests with report data by article ID:', error);
    throw error;
  }
};

/**
 * Get all requests with report data by article ID (cross-user search)
 * @param {string} articleId - The article ID
 * @returns {Promise<Array>} - Array of request records
 */
const getRequestsWithReportDataByArticleIdAnyUser = async (articleId) => {
  try {
    const db = await getDBConnection();
    
    const result = await new Promise((resolve, reject) => {
      db.all(
        `SELECT * FROM requests 
         WHERE article_id = ? 
         ORDER BY created_at DESC`,
        [articleId],
        (err, rows) => {
          if (err) reject(err);
          else {
            // Parse report_data for each row
            const parsedRows = rows.map(row => {
              if (row.report_data) {
                try {
                  row.report_data = JSON.parse(row.report_data);
                } catch (parseError) {
                  console.error('Error parsing report data:', parseError);
                  row.report_data = null;
                }
              }
              return row;
            });
            resolve(parsedRows || []);
          }
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
    console.error('Error getting requests with report data by article ID (any user):', error);
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
 * Get request_id for a given article_id (return the newest one, cross-user search)
 * @param {string} articleId - The article ID
 * @returns {Promise<string|null>} - The request ID or null if not found
 */
const getRequestIdByArticleIdAnyUser = async (articleId) => {
  try {
    const db = await getDBConnection();
    
    const result = await new Promise((resolve, reject) => {
      db.get(
        'SELECT request_id FROM requests WHERE article_id = ? ORDER BY created_at DESC LIMIT 1',
        [articleId],
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
    console.error('Error getting request_id by article_id (any user):', error);
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
 * Get article_id for a given request_id (cross-user search)
 * @param {string} requestId - The request ID
 * @returns {Promise<string|null>} - The article ID or null if not found
 */
const getArticleIdByRequestIdAnyUser = async (requestId) => {
  try {
    const db = await getDBConnection();
    
    const result = await new Promise((resolve, reject) => {
      db.get(
        'SELECT article_id FROM requests WHERE request_id = ?',
        [requestId],
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
    console.error('Error getting article_id by request_id (any user):', error);
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

/**
 * Get all request_ids for a given article_id (ordered by newest first, cross-user search)
 * @param {string} articleId - The article ID
 * @returns {Promise<string[]>} - Array of request IDs
 */
const getRequestIdsByArticleIdAnyUser = async (articleId) => {
  try {
    const db = await getDBConnection();
    
    const result = await new Promise((resolve, reject) => {
      db.all(
        'SELECT request_id FROM requests WHERE article_id = ? ORDER BY created_at DESC',
        [articleId],
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
    console.error('Error getting request_ids by article_id (any user):', error);
    throw error;
  }
};

/*
 * EDITORIAL MANAGER SUBMISSIONS METHODS
 */

/**
 * Store a new Editorial Manager submission
 * @param {string} requestId - The request ID
 * @param {string} serviceId - The service ID
 * @param {string} publicationCode - The publication code
 * @param {string} documentId - The document ID
 * @returns {Promise<number>} - ID of the inserted record
 */
const storeEmSubmission = async (requestId, serviceId, publicationCode, documentId) => {
  try {
    const db = await getDBConnection();
    
    const result = await new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO "editorial-manager-submissions" (request_id, service_id, publication_code, document_id)
         VALUES (?, ?, ?, ?)`,
        [requestId, serviceId, publicationCode, documentId],
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
    console.error('Error storing EM submission:', error);
    throw error;
  }
};

/**
 * Get submission by request ID
 * @param {string} requestId - The request ID
 * @returns {Promise<Object|null>} - Submission record or null if not found
 */
const getEmSubmissionByRequestId = async (requestId) => {
  try {
    const db = await getDBConnection();
    
    const result = await new Promise((resolve, reject) => {
      db.get(
        `SELECT * FROM "editorial-manager-submissions" WHERE request_id = ?`,
        [requestId],
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
    console.error('Error getting EM submission by request ID:', error);
    throw error;
  }
};

/**
 * Update canceled_at timestamp for a submission
 * @param {string} requestId - The request ID
 * @returns {Promise<boolean>} - True if submission was found and updated
 */
const cancelEmSubmission = async (requestId) => {
  try {
    const db = await getDBConnection();
    const now = new Date().toISOString();
    
    const result = await new Promise((resolve, reject) => {
      db.run(
        `UPDATE "editorial-manager-submissions"
         SET canceled_at = ?
         WHERE request_id = ?`,
        [now, requestId],
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
    console.error('Error canceling EM submission:', error);
    throw error;
  }
};

/*
 * QUEUE MANAGEMENT METHODS
 */

/**
 * Add a job to the processing queue
 * @param {string} requestId - Unique request ID for the job
 * @param {string} jobType - Type of job
 * @param {Object} data - Job data (will be stored as JSON)
 * @param {number} maxRetries - Maximum number of retries
 * @param {number} priority - Job priority
 * @returns {Promise<Object>} - Created job record
 */
const addJobToQueue = async (requestId, jobType, data, maxRetries = 3, priority = 5) => {
  try {
    const db = await getDBConnection();
    
    // Convert data to JSON string
    const dataJson = JSON.stringify(data);
    
    // Insert job record
    await new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO processing_jobs 
         (request_id, job_type, status, priority, data, max_retries) 
         VALUES (?, ?, ?, ?, ?, ?)`,
        [requestId, jobType, 'pending', priority, dataJson, maxRetries],
        function(err) {
          if (err) reject(err);
          else resolve(this.lastID);
        }
      );
    });
    
    // Get the inserted job
    const job = await new Promise((resolve, reject) => {
      db.get(
        `SELECT * FROM processing_jobs WHERE request_id = ?`,
        [requestId],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });
    
    // Close database connection
    await new Promise((resolve, reject) => {
      db.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    
    return job;
  } catch (error) {
    console.error(`Error adding job to queue (${requestId}):`, error);
    throw error;
  }
};

/**
 * Update job status in the database
 * @param {string} requestId - Request ID of the job
 * @param {string} status - New status
 * @param {string} errorMessage - Error message if status is 'failed'
 * @param {Object} completionData - Data to store when job is completed
 * @returns {Promise<boolean>} - True if job was updated
 */
const updateJobStatus = async (requestId, status, errorMessage = null, completionData = null) => {
  try {
    const db = await getDBConnection();
    
    let sql, params;
    
    if (status === 'completed' && completionData) {
      // Update status and store completion data for completed jobs
      sql = `UPDATE processing_jobs 
             SET status = ?, 
                 completion_data = ?,
                 updated_at = CURRENT_TIMESTAMP
             WHERE request_id = ?`;
      params = [status, JSON.stringify(completionData), requestId];
    } else if (status === 'failed' && errorMessage) {
      // Update status and error message for failed jobs (but don't increment retries here)
      sql = `UPDATE processing_jobs 
             SET status = ?, 
                 error_message = ?,
                 updated_at = CURRENT_TIMESTAMP
             WHERE request_id = ?`;
      params = [status, errorMessage, requestId];
    } else if (status === 'retrying' && errorMessage) {
      // Update status and error message for retrying jobs (but don't increment retries here)
      sql = `UPDATE processing_jobs 
             SET status = ?, 
                 error_message = ?,
                 updated_at = CURRENT_TIMESTAMP
             WHERE request_id = ?`;
      params = [status, errorMessage, requestId];
    } else {
      // Simple status update
      sql = `UPDATE processing_jobs 
             SET status = ?, 
                 updated_at = CURRENT_TIMESTAMP
             WHERE request_id = ?`;
      params = [status, requestId];
    }
    
    const result = await new Promise((resolve, reject) => {
      db.run(sql, params, function(err) {
        if (err) reject(err);
        else resolve(this.changes > 0);
      });
    });
    
    // Close database connection
    await new Promise((resolve, reject) => {
      db.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    
    return result;
  } catch (error) {
    console.error(`Error updating job status (${requestId}):`, error);
    throw error;
  }
};

/**
 * Get the next pending job
 * @returns {Promise<Object|null>} - Next job to process or null if none available
 */
const getNextPendingJob = async () => {
  try {
    const db = await getDBConnection();
    
    // Get oldest pending job or failed job that has retries remaining, sorted by priority (highest first)
    const job = await new Promise((resolve, reject) => {
      db.get(
        `SELECT * FROM processing_jobs 
         WHERE (status = ? OR (status = ? AND retries < max_retries))
         ORDER BY priority DESC, created_at ASC
         LIMIT 1`,
        ['pending', 'failed'],
        (err, row) => {
          if (err) reject(err);
          else resolve(row || null);
        }
      );
    });
    
    // Close database connection
    await new Promise((resolve, reject) => {
      db.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    
    return job;
  } catch (error) {
    console.error('Error getting next pending job:', error);
    throw error;
  }
};

/**
 * Get job by request ID
 * @param {string} requestId - Request ID of the job
 * @returns {Promise<Object|null>} - Job record or null if not found
 */
const getJobByRequestId = async (requestId) => {
  try {
    const db = await getDBConnection();
    
    const job = await new Promise((resolve, reject) => {
      db.get(
        `SELECT * FROM processing_jobs WHERE request_id = ?`,
        [requestId],
        (err, row) => {
          if (err) reject(err);
          else resolve(row || null);
        }
      );
    });
    
    // Close database connection
    await new Promise((resolve, reject) => {
      db.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    
    return job;
  } catch (error) {
    console.error(`Error getting job (${requestId}):`, error);
    throw error;
  }
};

/**
 * Increment the retry count for a job
 * @param {string} requestId - Request ID of the job
 * @returns {Promise<boolean>} - True if successful
 */
const incrementJobRetries = async (requestId) => {
  try {
    const db = await getDBConnection();
    
    const result = await new Promise((resolve, reject) => {
      db.run(
        `UPDATE processing_jobs 
         SET retries = retries + 1, 
             updated_at = CURRENT_TIMESTAMP 
         WHERE request_id = ?`,
        [requestId],
        function(err) {
          if (err) {
            reject(err);
          } else {
            resolve(this.changes > 0);
          }
        }
      );
    });
    
    await new Promise((resolve, reject) => {
      db.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    
    console.log(`[DB] Incremented retry count for job ${requestId}`);
    return result;
  } catch (error) {
    console.error(`Error incrementing retry count for job ${requestId}:`, error);
    throw error;
  }
};

/**
 * Reset a job to pending status for manual retry
 * @param {string} requestId - Request ID of the job
 * @returns {Promise<boolean>} - True if successful
 */
const resetJobForRetry = async (requestId) => {
  try {
    const db = await getDBConnection();
    
    const result = await new Promise((resolve, reject) => {
      db.run(
        `UPDATE processing_jobs 
         SET status = 'pending', 
             error_message = NULL,
             updated_at = CURRENT_TIMESTAMP 
         WHERE request_id = ? AND status IN ('failed', 'processing')`,
        [requestId],
        function(err) {
          if (err) {
            reject(err);
          } else {
            resolve(this.changes > 0);
          }
        }
      );
    });
    
    await new Promise((resolve, reject) => {
      db.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    
    console.log(`[DB] Reset job ${requestId} to pending status for retry`);
    return result;
  } catch (error) {
    console.error(`Error resetting job ${requestId} for retry:`, error);
    throw error;
  }
};

/**
 * Get jobs that are stuck in processing state (for cleanup/recovery)
 * @param {number} timeoutMinutes - Consider jobs stuck after this many minutes
 * @returns {Promise<Array>} - Array of stuck jobs
 */
const getStuckJobs = async (timeoutMinutes = 30) => {
  try {
    const db = await getDBConnection();
    
    const jobs = await new Promise((resolve, reject) => {
      db.all(
        `SELECT * FROM processing_jobs 
         WHERE status = 'processing' 
         AND datetime(updated_at, '+${timeoutMinutes} minutes') < datetime('now')
         ORDER BY created_at ASC`,
        [],
        (err, rows) => {
          if (err) {
            reject(err);
          } else {
            resolve(rows || []);
          }
        }
      );
    });
    
    await new Promise((resolve, reject) => {
      db.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    
    return jobs;
  } catch (error) {
    console.error('Error getting stuck jobs:', error);
    return [];
  }
};

/**
 * Mark stuck jobs as failed for recovery
 * @param {number} timeoutMinutes - Consider jobs stuck after this many minutes
 * @returns {Promise<number>} - Number of jobs marked as failed
 */
const markStuckJobsAsFailed = async (timeoutMinutes = 30) => {
  try {
    const db = await getDBConnection();
    
    const result = await new Promise((resolve, reject) => {
      db.run(
        `UPDATE processing_jobs 
         SET status = 'failed', 
             error_message = 'Job marked as failed due to timeout',
             updated_at = CURRENT_TIMESTAMP
         WHERE status = 'processing' 
         AND datetime(updated_at, '+${timeoutMinutes} minutes') < datetime('now')`,
        [],
        function(err) {
          if (err) {
            reject(err);
          } else {
            resolve(this.changes);
          }
        }
      );
    });
    
    await new Promise((resolve, reject) => {
      db.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    
    if (result > 0) {
      console.log(`[DB] Marked ${result} stuck jobs as failed`);
    }
    
    return result;
  } catch (error) {
    console.error('Error marking stuck jobs as failed:', error);
    return 0;
  }
};

/**
 * Get all jobs with optional status filter
 * @param {string|null} status - Filter by status (optional)
 * @param {number} limit - Maximum number of jobs to return (default: 100)
 * @returns {Promise<Array>} - Array of jobs
 */
const getAllJobs = async (status = null, limit = 100) => {
  try {
    const db = await getDBConnection();
    
    let sql = `SELECT * FROM processing_jobs`;
    let params = [];
    
    if (status) {
      sql += ` WHERE status = ?`;
      params.push(status);
    }
    
    sql += ` ORDER BY created_at DESC LIMIT ?`;
    params.push(limit);
    
    const jobs = await new Promise((resolve, reject) => {
      db.all(sql, params, (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows || []);
        }
      });
    });
    
    await new Promise((resolve, reject) => {
      db.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    
    return jobs;
  } catch (error) {
    console.error('Error getting all jobs:', error);
    return [];
  }
};

/**
 * Clean up old completed jobs
 * @param {number} daysOld - Delete jobs older than this many days
 * @returns {Promise<number>} - Number of jobs deleted
 */
const cleanupOldJobs = async (daysOld = 30) => {
  try {
    const db = await getDBConnection();
    
    const result = await new Promise((resolve, reject) => {
      db.run(
        `DELETE FROM processing_jobs 
         WHERE status = 'completed' 
         AND datetime(created_at, '+${daysOld} days') < datetime('now')`,
        [],
        function(err) {
          if (err) {
            reject(err);
          } else {
            resolve(this.changes);
          }
        }
      );
    });
    
    await new Promise((resolve, reject) => {
      db.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    
    if (result > 0) {
      console.log(`[DB] Cleaned up ${result} old completed jobs`);
    }
    
    return result;
  } catch (error) {
    console.error('Error cleaning up old jobs:', error);
    return 0;
  }
};

module.exports = {
  initDatabase,
  getDBConnection,
  
  // Token management methods
  getValidToken,
  storeToken,
  revokeToken,
  isTokenValid,
  cleanupExpiredTokens,
  
  // Request and report management methods (existing user-specific)
  addOrUpdateRequest,
  updateRequestReportData,
  getRequestWithReportData,
  getRequestsWithReportDataByArticleId,
  deleteRequest,
  getRequestIdByArticleId,
  getArticleIdByRequestId,
  getRequestIdsByArticleId,
  
  // NEW: Cross-user search methods
  getRequestWithReportDataAnyUser,
  getRequestsWithReportDataByArticleIdAnyUser,
  getRequestIdByArticleIdAnyUser,
  getArticleIdByRequestIdAnyUser,
  getRequestIdsByArticleIdAnyUser,
  
  // Editorial Manager submissions methods
  storeEmSubmission,
  getEmSubmissionByRequestId,
  cancelEmSubmission,
  
  // Queue management methods
  addJobToQueue,
  updateJobStatus,
  getNextPendingJob,
  getJobByRequestId,
  
  // Retry and cleanup methods
  incrementJobRetries,
  resetJobForRetry,
  getStuckJobs,
  markStuckJobsAsFailed,
  getAllJobs,
  cleanupOldJobs
};
