// File: scripts/maintenance/initDB.js
const { 
  initDatabase, 
  refreshRequestsFromS3,
  getRequestIdsByArticleId
} = require('../../src/utils/requestsManager');

// Command line arguments
const command = process.argv[2];

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

      default: {
        console.log('Usage:');
        console.log('  npm run db:init    - Initialize database');
        console.log('  npm run db:refresh - Refresh requests from S3');
        console.log('  npm run db:check <userName> <articleId> - Check request IDs for an article');
        break;
      }
    }
  } catch (error) {
    console.error('Error:', error);
    throw new Error(`Process failed: ${error.message}`);
  }
};

main();
