// File: src/utils/requestsManager.js
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const { getAllOptionsFiles } = require('./s3Storage');

// Create sqlite directory if it doesn't exist
const SQLITE_DIR = path.join(__dirname, '../../sqlite');
if (!fs.existsSync(SQLITE_DIR)) {
  fs.mkdirSync(SQLITE_DIR, { recursive: true });
}

const DB_PATH = path.join(SQLITE_DIR, 'requests.db');

// Initialize database
const initDatabase = () => {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(DB_PATH, (err) => {
      if (err) {
        console.error('Error opening database:', err);
        reject(err);
        return;
      }
      
      // Create the table if it doesn't exist
      db.run(`CREATE TABLE IF NOT EXISTS article_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_name TEXT NOT NULL,
        article_id TEXT NOT NULL,
        request_id TEXT NOT NULL UNIQUE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`, (err) => {
        if (err) {
          console.error('Error creating table:', err);
          reject(err);
        } else {
          resolve(db);
        }
      });
    });
  });
};

// Refresh all requests from S3
// Debugging version of refreshRequestsFromS3
const refreshRequestsFromS3 = async () => {
  try {
    const db = await initDatabase();
    
    console.log("Starting refreshRequestsFromS3...");
    
    // Get all options files from S3
    const optionsFiles = await getAllOptionsFiles();
    console.log(`Total S3 options files retrieved: ${optionsFiles.length}`);
    
    // Count how many have valid article_id
    const validFiles = optionsFiles.filter(file => file.content && file.content.article_id);
    console.log(`Files with valid article_id: ${validFiles.length}`);
    
    // Check for duplicate request_ids
    const requestIds = validFiles.map(file => file.requestId);
    const uniqueRequestIds = new Set(requestIds);
    console.log(`Unique request_ids: ${uniqueRequestIds.size} out of ${requestIds.length}`);
    
    // Find duplicates
    const duplicateIds = requestIds.filter((id, index) => requestIds.indexOf(id) !== index);
    const uniqueDuplicateIds = [...new Set(duplicateIds)];
    console.log(`Number of duplicate request_ids: ${uniqueDuplicateIds.length}`);
    if (uniqueDuplicateIds.length > 0) {
      console.log(`First few duplicate IDs: ${uniqueDuplicateIds.slice(0, 5).join(', ')}`);
    }
    
    // Clear existing data
    await new Promise((resolve, reject) => {
      db.run('DELETE FROM article_requests', (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    console.log("Cleared existing article_requests table");
    
    // Insert new requests - using INSERT OR REPLACE since request_id is unique
    const stmt = db.prepare('INSERT OR REPLACE INTO article_requests (user_name, article_id, request_id, created_at) VALUES (?, ?, ?, ?)');
    
    let insertedCount = 0;
    let errorCount = 0;
    
    for (const file of optionsFiles) {
      if (file.content && file.content.article_id) {
        try {
          // Format the date as 'YYYY-MM-DD HH:MM:SS' for SQLite
          const formattedDate = file.lastModified instanceof Date
            ? file.lastModified.toISOString().replace('T', ' ').split('.')[0]
            : new Date(file.lastModified).toISOString().replace('T', ' ').split('.')[0];
          
          await new Promise((resolve, reject) => {
            stmt.run(file.userId, file.content.article_id, file.requestId, formattedDate, (err) => {
              if (err) {
                console.error(`Error inserting request for ${file.userId}/${file.requestId}:`, err);
                errorCount++;
                reject(err);
              } else {
                insertedCount++;
                resolve();
              }
            });
          });
        } catch (error) {
          console.error(`Exception processing file ${file.requestId}:`, error);
          errorCount++;
        }
      }
    }
    
    console.log(`Inserted ${insertedCount} records, Errors: ${errorCount}`);
    
    // Count records in the database
    const recordCount = await new Promise((resolve, reject) => {
      db.get('SELECT COUNT(*) as count FROM article_requests', (err, row) => {
        if (err) reject(err);
        else resolve(row.count);
      });
    });
    
    console.log(`Final record count in database: ${recordCount}`);
    
    stmt.finalize();
    db.close();
    
    return true;
  } catch (error) {
    console.error('Error refreshing requests from S3:', error);
    throw error;
  }
};

// Add or update a request
const addOrUpdateRequest = async (userName, articleId, requestId) => {
  try {
    const db = await initDatabase();
    
    // Using INSERT OR REPLACE since request_id is unique
    const result = await new Promise((resolve, reject) => {
      db.run(
        'INSERT OR REPLACE INTO article_requests (user_name, article_id, request_id) VALUES (?, ?, ?)',
        [userName, articleId, requestId],
        function(err) {
          if (err) reject(err);
          else resolve({ changes: this.changes });
        }
      );
    });
    
    db.close();
    return result;
  } catch (error) {
    console.error('Error adding/updating request:', error);
    throw error;
  }
};

// Delete a request
const deleteRequest = async (userName, articleId, requestId = null) => {
  try {
    const db = await initDatabase();
    
    let sql, params;
    
    if (requestId) {
      // If requestId is provided, it's a simple primary key delete
      sql = 'DELETE FROM article_requests WHERE request_id = ?';
      params = [requestId];
    } else {
      // If only article_id is provided, delete all requests for this article and user
      sql = 'DELETE FROM article_requests WHERE user_name = ? AND article_id = ?';
      params = [userName, articleId];
    }
    
    const result = await new Promise((resolve, reject) => {
      db.run(sql, params, function(err) {
        if (err) reject(err);
        else resolve({ changes: this.changes });
      });
    });
    
    db.close();
    return result;
  } catch (error) {
    console.error('Error deleting request:', error);
    throw error;
  }
};

// Get request_id for a given article_id (return the newest one)
const getRequestIdByArticleId = async (userName, articleId) => {
  try {
    const db = await initDatabase();
    
    // Added ORDER BY created_at DESC to get the newest request
    const requestId = await new Promise((resolve, reject) => {
      db.get(
        'SELECT request_id FROM article_requests WHERE user_name = ? AND article_id = ? ORDER BY created_at DESC LIMIT 1',
        [userName, articleId],
        (err, row) => {
          if (err) reject(err);
          else resolve(row ? row.request_id : null);
        }
      );
    });
    
    db.close();
    return requestId;
  } catch (error) {
    console.error('Error getting request_id by article_id:', error);
    throw error;
  }
};

// Get article_id for a given request_id (there should be only one due to unique constraint)
const getArticleIdByRequestId = async (userName, requestId) => {
  try {
    const db = await initDatabase();
    
    const articleId = await new Promise((resolve, reject) => {
      db.get(
        'SELECT article_id FROM article_requests WHERE user_name = ? AND request_id = ?',
        [userName, requestId],
        (err, row) => {
          if (err) reject(err);
          else resolve(row ? row.article_id : null);
        }
      );
    });
    
    db.close();
    return articleId;
  } catch (error) {
    console.error('Error getting article_id by request_id:', error);
    throw error;
  }
};

// Get all request_ids for a given article_id (ordered by newest first)
const getRequestIdsByArticleId = async (userName, articleId) => {
  try {
    const db = await initDatabase();
    
    // Added ORDER BY created_at DESC to get newest requests first
    const requestIds = await new Promise((resolve, reject) => {
      db.all(
        'SELECT request_id FROM article_requests WHERE user_name = ? AND article_id = ? ORDER BY created_at DESC',
        [userName, articleId],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows ? rows.map(row => row.request_id) : []);
        }
      );
    });
    
    db.close();
    return requestIds;
  } catch (error) {
    console.error('Error getting request_ids by article_id:', error);
    throw error;
  }
};

module.exports = {
  initDatabase,
  refreshRequestsFromS3,
  addOrUpdateRequest,
  deleteRequest,
  getRequestIdByArticleId,
  getArticleIdByRequestId,
  getRequestIdsByArticleId
};
