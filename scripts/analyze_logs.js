// File: scripts/manage_permissions.js
const fs = require('fs');
const readline = require('readline');
const path = require('path');

async function analyzeLog(filename) {
  const fileStream = fs.createReadStream(filename);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  const stats = {
    users: {},
    ips: {}
  };

  for await (const line of rl) {
    const log = JSON.parse(line);
    if (log.url) {
      let category, identifier;

      if (log.user && log.user !== 'unauthenticated') {
        category = 'users';
        identifier = log.user;
      } else if (log.ip) {
        category = 'ips';
        identifier = log.ip;
      } else {
        console.warn('Log entry has neither user nor IP:', log);
        continue;
      }

      if (!stats[category][identifier]) {
        stats[category][identifier] = {
          total: 0,
          success: 0,
          urls: {}
        };
      }

      stats[category][identifier].total++;
      if (log.success) {
        stats[category][identifier].success++;
      }

      if (!stats[category][identifier].urls[log.url]) {
        stats[category][identifier].urls[log.url] = {
          total: 0,
          success: 0
        };
      }

      stats[category][identifier].urls[log.url].total++;
      if (log.success) {
        stats[category][identifier].urls[log.url].success++;
      }
    }
  }

  console.log('Request Statistics:');
  
  ['users', 'ips'].forEach(category => {
    console.log(`\n${category.toUpperCase()} Statistics:`);
    for (const [identifier, data] of Object.entries(stats[category])) {
      console.log(`\n${category === 'users' ? 'User' : 'IP'}: ${identifier}`);
      console.log(`  Total Requests: ${data.total}`);
      console.log(`  Successful Requests: ${data.success}`);
      console.log(`  Overall Success Rate: ${((data.success / data.total) * 100).toFixed(2)}%`);
      console.log('  URL Breakdown:');
      
      for (const [url, urlStats] of Object.entries(data.urls)) {
        console.log(`    URL: ${url}`);
        console.log(`      Total Requests: ${urlStats.total}`);
        console.log(`      Successful Requests: ${urlStats.success}`);
        console.log(`      Success Rate: ${((urlStats.success / urlStats.total) * 100).toFixed(2)}%`);
      }
    }
    console.log('---');
  });
}

// Get the log file path from command line arguments or use a default
const logFile = process.argv[2] || path.join(__dirname, '..', 'log/combined.log');

analyzeLog(logFile);
