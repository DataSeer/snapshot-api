// File: scripts/rebuild_logs.js
// CLI tool to initialize and rebuild Google Sheets logs
// Usage: node scripts/rebuild_logs.js [--init | --all | --admin | --user <userId>]

const printUsage = () => {
  console.log('Usage: node scripts/rebuild_logs.js [--check | --init [--add-users] | --all | --admin | --user <userId>]');
  console.log('');
  console.log('Options:');
  console.log('  --check             Verify service account access to configured folders and templates');
  console.log('  --init              Create Drive folders and spreadsheets for users in googleSheets.logs.json');
  console.log('  --init --add-users  Same as --init but first imports all users from users.json into logsConfig');
  console.log('  --all               Rebuild all logs (admin + all configured users)');
  console.log('  --admin             Rebuild admin/genshare logs only');
  console.log('  --user <userId>     Rebuild logs for a specific user');
  console.log('');
  console.log('Examples:');
  console.log('  node scripts/rebuild_logs.js --check');
  console.log('  node scripts/rebuild_logs.js --init');
  console.log('  node scripts/rebuild_logs.js --init --add-users');
  console.log('  node scripts/rebuild_logs.js --all');
  console.log('  node scripts/rebuild_logs.js --admin');
  console.log('  node scripts/rebuild_logs.js --user KWG');
};

const main = async () => {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    printUsage();
    return;
  }

  if (args.includes('--check')) {
    const { driveService, readLogsConfigFromDisk } = require('../src/utils/googleSheets');
    const logsConfig = readLogsConfigFromDisk();

    console.log('Checking service account access...\n');

    // Check main folder
    const folderId = logsConfig.folderId;
    if (folderId) {
      try {
        const res = await driveService.files.get({ fileId: folderId, fields: 'id,name,mimeType,capabilities', supportsAllDrives: true });
        const caps = res.data.capabilities || {};
        console.log(`[OK] Main folder: "${res.data.name}" (${folderId})`);
        console.log(`     Type: ${res.data.mimeType}`);
        console.log(`     Can add children: ${caps.canAddChildren || false}`);
        console.log(`     Can edit: ${caps.canEdit || false}`);
      } catch (err) {
        console.log(`[FAIL] Main folder (${folderId}): ${err.message}`);
      }
    } else {
      console.log('[SKIP] No folderId configured');
    }

    // Check existing spreadsheets
    const genshareId = logsConfig.genshare?.spreadsheetId;
    if (genshareId) {
      try {
        const res = await driveService.files.get({ fileId: genshareId, fields: 'id,name', supportsAllDrives: true });
        console.log(`[OK] Genshare spreadsheet: "${res.data.name}" (${genshareId})`);
      } catch (err) {
        console.log(`[FAIL] Genshare spreadsheet (${genshareId}): ${err.message}`);
      }
    }

    for (const [userId, userConfig] of Object.entries(logsConfig.users || {})) {
      if (userConfig.folderId) {
        try {
          const res = await driveService.files.get({ fileId: userConfig.folderId, fields: 'id,name,capabilities', supportsAllDrives: true });
          console.log(`[OK] User "${userId}" folder: "${res.data.name}" (${userConfig.folderId})`);
        } catch (err) {
          console.log(`[FAIL] User "${userId}" folder (${userConfig.folderId}): ${err.message}`);
        }
      }
      if (userConfig.spreadsheetId) {
        try {
          const res = await driveService.files.get({ fileId: userConfig.spreadsheetId, fields: 'id,name', supportsAllDrives: true });
          console.log(`[OK] User "${userId}" spreadsheet: "${res.data.name}" (${userConfig.spreadsheetId})`);
        } catch (err) {
          console.log(`[FAIL] User "${userId}" spreadsheet (${userConfig.spreadsheetId}): ${err.message}`);
        }
      }
    }

    console.log('\nCheck complete.');
    return;
  }

  if (args.includes('--init')) {
    const { ensureGenshareSpreadsheet, ensureUserFolder, ensureUserSpreadsheet, readLogsConfigFromDisk, saveLogsConfig } = require('../src/utils/googleSheets');
    const { getAllUsers } = require('../src/utils/userManager');

    // --init --add-users: add all users from users.json to logsConfig before initializing
    if (args.includes('--add-users')) {
      const allUsers = getAllUsers();
      const userIds = Object.keys(allUsers);
      const logsConfig = readLogsConfigFromDisk();
      let added = 0;

      for (const userId of userIds) {
        if (!logsConfig.users[userId]) {
          logsConfig.users[userId] = {};
          added++;
        }
      }

      if (added > 0) {
        saveLogsConfig(logsConfig);
      }
      console.log(`[Init] ${added > 0 ? `Added ${added} new users. ` : ''}${Object.keys(logsConfig.users).length} users in logsConfig\n`);
    }

    const logsConfig = readLogsConfigFromDisk();
    const userIds = Object.keys(logsConfig.users || {});

    console.log('Initializing log folders and spreadsheets...\n');

    // Genshare (placed directly in the main folder)
    console.log('[Init] Ensuring genshare log spreadsheet...');
    const genshareId = await ensureGenshareSpreadsheet();
    console.log(`[Init] Genshare spreadsheet: ${genshareId}\n`);

    if (userIds.length === 0) {
      console.log('[Init] No users configured in googleSheets.logs.json.');
      console.log('[Init] Add users manually or run with --add-users to import from users.json');
      console.log('[Init] Example: node scripts/rebuild_logs.js --init --add-users\n');
    }

    // Users — create folder first, then spreadsheet inside it
    for (const userId of userIds) {
      console.log(`[Init] Ensuring folder for user "${userId}"...`);
      const folderId = await ensureUserFolder(userId);
      console.log(`[Init] User "${userId}" folder: ${folderId}`);

      console.log(`[Init] Ensuring log spreadsheet for user "${userId}"...`);
      const spreadsheetId = await ensureUserSpreadsheet(userId);
      console.log(`[Init] User "${userId}" spreadsheet: ${spreadsheetId}\n`);
    }

    console.log('Initialization complete.');
    return;
  }

  const { rebuildAdminLogs, rebuildUserLogs, rebuildAllLogs } = require('../src/utils/googleSheetsRebuild');
  const { refreshRequestsFromS3 } = require('../src/utils/requestsManager');

  if (args.includes('--all')) {
    // rebuildAllLogs already refreshes from S3 internally
    console.log('Rebuilding all logs...');
    const result = await rebuildAllLogs();
    console.log('\nAdmin logs:', JSON.stringify(result.admin, null, 2));
    console.log('\nUser logs:', JSON.stringify(result.users, null, 2));
  } else if (args.includes('--admin')) {
    console.log('Refreshing requests from S3...');
    await refreshRequestsFromS3();
    console.log('Rebuilding admin logs...');
    const result = await rebuildAdminLogs();
    console.log('\nResult:', JSON.stringify(result, null, 2));
  } else if (args.includes('--user')) {
    const userIndex = args.indexOf('--user');
    const userId = args[userIndex + 1];
    if (!userId) {
      console.error('Error: --user requires a userId argument');
      printUsage();
      return;
    }
    console.log('Refreshing requests from S3...');
    await refreshRequestsFromS3();
    console.log(`Rebuilding logs for user "${userId}"...`);
    const result = await rebuildUserLogs(userId);
    console.log('\nResult:', JSON.stringify(result, null, 2));
  } else {
    console.error('Error: Unknown option:', args[0]);
    printUsage();
    return;
  }

  console.log('\nDone.');
};

main().catch((error) => {
  console.error('\nError:', error.message);
});
