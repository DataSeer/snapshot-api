// File: scripts/maintenance/initDB.js
const { 
  initDatabase, 
  refreshRequestsFromS3,
  getRequestIdsByArticleId
} = require('../../src/utils/requestsManager');

const dbManager = require('../../src/utils/dbManager');

// Command line arguments
const command = process.argv[2];

/**
 * Check if ScholarOne submissions table exists and has correct schema
 */
const checkScholarOneTable = async () => {
  const db = await dbManager.getDBConnection();
  
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT sql FROM sqlite_master WHERE type='table' AND name='scholarone-submissions'`,
      (err, row) => {
        if (err) {
          db.close();
          reject(err);
        } else {
          db.close();
          resolve(row);
        }
      }
    );
  });
};

/**
 * Drop and recreate ScholarOne submissions table
 */
const recreateScholarOneTable = async () => {
  const db = await dbManager.getDBConnection();
  
  try {
    // Drop existing table
    await new Promise((resolve, reject) => {
      db.run(`DROP TABLE IF EXISTS "scholarone-submissions"`, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    
    console.log('Dropped existing scholarone-submissions table');
    
    // Create new table with correct schema
    await new Promise((resolve, reject) => {
      db.run(`CREATE TABLE IF NOT EXISTS "scholarone-submissions" (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        request_id TEXT NOT NULL UNIQUE,
        site_name TEXT NOT NULL,
        submission_id TEXT NOT NULL,
        canceled_at DATETIME DEFAULT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`, (err) => {
        if (err) {
          console.error('Error creating scholarone-submissions table:', err);
          reject(err);
        } else {
          resolve();
        }
      });
    });
    
    console.log('Created scholarone-submissions table with correct schema');
    
    await new Promise((resolve, reject) => {
      db.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    
  } catch (error) {
    await new Promise((resolve) => {
      db.close(() => resolve());
    });
    throw error;
  }
};

/**
 * Check ScholarOne submission by submission ID
 */
const checkScholarOneSubmission = async (submissionId) => {
  const submission = await dbManager.getScholaroneSubmissionBySubmissionId(submissionId);
  
  if (submission) {
    console.log('\nScholarOne Submission Found:');
    console.log(`  ID: ${submission.id}`);
    console.log(`  Request ID: ${submission.request_id}`);
    console.log(`  Site Name: ${submission.site_name}`);
    console.log(`  Submission ID: ${submission.submission_id}`);
    console.log(`  Created At: ${submission.created_at}`);
    console.log(`  Canceled At: ${submission.canceled_at || 'Not canceled'}`);
  } else {
    console.log(`\nNo ScholarOne submission found for submission ID: ${submissionId}`);
  }
  
  return submission;
};

/**
 * List all ScholarOne submissions
 */
const listScholarOneSubmissions = async (limit = 10) => {
  const db = await dbManager.getDBConnection();
  
  try {
    const submissions = await new Promise((resolve, reject) => {
      db.all(
        `SELECT * FROM "scholarone-submissions" ORDER BY created_at DESC LIMIT ?`,
        [limit],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        }
      );
    });
    
    await new Promise((resolve, reject) => {
      db.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    
    if (submissions.length === 0) {
      console.log('\nNo ScholarOne submissions found');
    } else {
      console.log(`\nFound ${submissions.length} ScholarOne submission(s):\n`);
      submissions.forEach((sub, index) => {
        console.log(`[${index + 1}] Submission ID: ${sub.submission_id}`);
        console.log(`    Request ID: ${sub.request_id}`);
        console.log(`    Site: ${sub.site_name}`);
        console.log(`    Created: ${sub.created_at}`);
        console.log(`    Canceled: ${sub.canceled_at || 'No'}\n`);
      });
    }
    
    return submissions;
  } catch (error) {
    await new Promise((resolve) => {
      db.close(() => resolve());
    });
    throw error;
  }
};

const main = async () => {
  try {
    switch (command) {
      case 'init': {
        console.log('Initializing database...');
        await initDatabase();
        console.log('Database initialized successfully');
        break;
      }

      case 'refresh': {
        console.log('Refreshing requests from S3...');
        await refreshRequestsFromS3();
        console.log('Requests refreshed successfully');
        break;
      }

      case 'check': {
        const [, , , userName, articleId] = process.argv;
        if (!userName || !articleId) {
          console.log('Usage: npm run db:check <userName> <articleId>');
          return;
        }
        console.log(`Checking request IDs for user "${userName}" and article "${articleId}"...`);
        const requestIds = await getRequestIdsByArticleId(userName, articleId);
        console.log(`Found ${requestIds.length} request IDs:`, requestIds);
        break;
      }

      case 'check-scholarone-table': {
        console.log('Checking ScholarOne table schema...');
        const tableInfo = await checkScholarOneTable();
        
        if (!tableInfo) {
          console.log('❌ ScholarOne submissions table does not exist');
          console.log('Run: npm run db:fix-scholarone to create it');
        } else {
          console.log('✓ ScholarOne submissions table exists');
          console.log('\nTable schema:');
          console.log(tableInfo.sql);
          
          // Check if it has the correct columns
          if (tableInfo.sql.includes('submission_id') && tableInfo.sql.includes('site_name')) {
            console.log('\n✓ Table has correct schema');
          } else {
            console.log('\n❌ Table has incorrect schema');
            console.log('Run: npm run db:fix-scholarone to recreate it');
          }
        }
        break;
      }

      case 'fix-scholarone': {
        console.log('Recreating ScholarOne submissions table...');
        await recreateScholarOneTable();
        console.log('✓ ScholarOne table recreated successfully');
        break;
      }

      case 'check-scholarone': {
        const [, , , submissionId] = process.argv;
        if (!submissionId) {
          console.log('Usage: npm run db:check-scholarone <submissionId>');
          console.log('Example: npm run db:check-scholarone WRK1-2025-10-0008');
          return;
        }
        await checkScholarOneSubmission(submissionId);
        break;
      }

      case 'list-scholarone': {
        const [, , , limitStr] = process.argv;
        const limit = limitStr ? parseInt(limitStr) : 10;
        console.log(`Listing last ${limit} ScholarOne submissions...`);
        await listScholarOneSubmissions(limit);
        break;
      }

      case 'check-scholarone-notifications': {
        const [, , , messageUUID] = process.argv;
        if (!messageUUID) {
          console.log('Usage: npm run db:check-notification <messageUUID>');
          console.log('Example: npm run db:check-notification 9d7e3773-32ea-481e-a647-944bbe9c24b7');
          return;
        }
        
        const dbManager = require('../../src/utils/dbManager');
        const notification = await dbManager.getScholaroneNotificationByMessageUUID(messageUUID);
        
        if (notification) {
          console.log('\nScholarOne Notification Found:');
          console.log(`  ID: ${notification.id}`);
          console.log(`  Message UUID: ${notification.message_uuid}`);
          console.log(`  Site Name: ${notification.site_name}`);
          console.log(`  Submission ID: ${notification.submission_id || 'N/A'}`);
          console.log(`  Event: ${notification.system_event_name || 'N/A'}`);
          console.log(`  Processed: ${notification.processed ? 'Yes' : 'No'}`);
          console.log(`  Request ID: ${notification.request_id || 'N/A'}`);
          console.log(`  Created At: ${notification.created_at}`);
        } else {
          console.log(`\nNo notification found for messageUUID: ${messageUUID}`);
        }
        break;
      }

      case 'list-scholarone-notifications': {
        const [, , , limitStr] = process.argv;
        const limit = limitStr ? parseInt(limitStr) : 10;
        
        const db = await dbManager.getDBConnection();
        
        try {
          const notifications = await new Promise((resolve, reject) => {
            db.all(
              `SELECT * FROM "scholarone-notifications" ORDER BY created_at DESC LIMIT ?`,
              [limit],
              (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
              }
            );
          });
          
          await new Promise((resolve, reject) => {
            db.close((err) => {
              if (err) reject(err);
              else resolve();
            });
          });
          
          if (notifications.length === 0) {
            console.log('\nNo ScholarOne notifications found');
          } else {
            console.log(`\nFound ${notifications.length} ScholarOne notification(s):\n`);
            notifications.forEach((notif, index) => {
              console.log(`[${index + 1}] Message UUID: ${notif.message_uuid}`);
              console.log(`    Submission ID: ${notif.submission_id || 'N/A'}`);
              console.log(`    Event: ${notif.system_event_name || 'N/A'}`);
              console.log(`    Site: ${notif.site_name}`);
              console.log(`    Processed: ${notif.processed ? 'Yes' : 'No'}`);
              console.log(`    Request ID: ${notif.request_id || 'N/A'}`);
              console.log(`    Created: ${notif.created_at}\n`);
            });
          }
        } catch (error) {
          await new Promise((resolve) => {
            db.close(() => resolve());
          });
          throw error;
        }
        break;
      }

      default: {
        console.log('Usage:');
        console.log('  npm run db:init                - Initialize database');
        console.log('  npm run db:refresh             - Refresh requests from S3');
        console.log('  npm run db:check <userName> <articleId> - Check request IDs for an article');
        console.log('');
        console.log('ScholarOne Submissions commands:');
        console.log('  npm run db:check-scholarone-table       - Check ScholarOne table schema');
        console.log('  npm run db:fix-scholarone               - Recreate ScholarOne table');
        console.log('  npm run db:check-scholarone <subId>     - Check ScholarOne submission');
        console.log('  npm run db:list-scholarone [limit]      - List ScholarOne submissions');
        console.log('');
        console.log('ScholarOne Notifications commands:');
        console.log('  npm run db:check-notification <uuid>    - Check notification by message UUID');
        console.log('  npm run db:list-notifications [limit]   - List ScholarOne notifications');
        break;
      }
    }
  } catch (error) {
    console.error('Error:', error);
    throw new Error(`Process failed: ${error.message}`);
  }
};

main();
