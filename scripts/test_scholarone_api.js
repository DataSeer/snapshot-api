// File: scripts/test_scholarone_notifications.js

const axios = require('axios');
const crypto = require('crypto');
const config = require('../src/config');
const scholaroneConfig = require(config.scholaroneConfigPath);

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';

/**
 * Generate a mock notification payload based on ScholarOne's format
 * @param {Object} options - Notification options
 * @returns {Object} Query parameters object
 */
const generateNotificationPayload = (options = {}) => {
  const {
    siteName = 'test-site',
    submissionId = 'TEST-2025-001',
    documentId = '12345',
    systemEventName = 'Author_Submit_Manuscript_Orig',
    submissionTitle = 'Test Manuscript Submission',
    documentStatusName = 'Submitted'
  } = options;
  
  // Generate unique message UUID
  const messageUUID = crypto.randomUUID();
  
  // Current timestamp in ISO format
  const eventDate = new Date().toISOString();
  
  return {
    messageUUID,
    notificationServiceVersion: 'V2',
    siteName,
    journalName: `Journal of ${siteName}`,
    eventDate,
    subscriptionId: 1001,
    subscriptionName: 'Manuscript Submission Notifications',
    subscriptionType: 'SYSTEM_EVENT',
    documentId,
    submissionId,
    documentStatusName,
    submissionTitle,
    systemEventName
  };
};

/**
 * Generate HMAC signature for the payload
 * @param {Object} payload - The notification payload
 * @param {string} sharedSecret - The shared secret
 * @returns {string} The HMAC signature
 */
const generateSignature = (payload, sharedSecret) => {
  const payloadString = JSON.stringify(payload);
  return crypto
    .createHmac('sha256', sharedSecret)
    .update(payloadString)
    .digest('hex');
};

/**
 * Send a test notification to the API
 */
const sendTestNotification = async (options = {}) => {
  console.log('\n=== Sending Test Notification ===');
  
  const payload = generateNotificationPayload(options);
  
  console.log('\nNotification Details:');
  console.log(`  Message UUID: ${payload.messageUUID}`);
  console.log(`  Site Name: ${payload.siteName}`);
  console.log(`  Submission ID: ${payload.submissionId}`);
  console.log(`  Event: ${payload.systemEventName}`);
  console.log(`  Document ID: ${payload.documentId}`);
  
  // Get shared secret from config
  const sharedSecret = scholaroneConfig.notifications?.shared_secret;
  
  const headers = {};
  
  if (sharedSecret) {
    const signature = generateSignature(payload, sharedSecret);
    headers['x-scholarone-signature'] = signature;
    console.log(`  Signature: ${signature.substring(0, 20)}...`);
  }
  
  console.log('\nSending notification to API...');
  
  try {
    const response = await axios.get(
      `${API_BASE_URL}/scholarone/notifications`,
      {
        params: payload,
        headers
      }
    );
    
    console.log('\n✓ Response received:');
    console.log(`  Status: ${response.status}`);
    console.log(`  Message: ${response.data.message}`);
    console.log(`  Processed: ${response.data.processed}`);
    console.log(`  Reason: ${response.data.reason}`);
    
    if (response.data.request_id) {
      console.log(`  Request ID: ${response.data.request_id}`);
      console.log(`\nCheck status with:`);
      console.log(`  node scripts/test_scholarone_notifications.js check-request ${response.data.request_id}`);
    }
    
    return response.data;
  } catch (error) {
    console.error('\n✗ Error sending notification:');
    if (error.response) {
      console.error(`  Status: ${error.response.status}`);
      console.error(`  Error:`, error.response.data);
    } else {
      console.error(`  ${error.message}`);
    }
    throw error;
  }
};

/**
 * Send a duplicate notification to test idempotency
 */
const sendDuplicateNotification = async (messageUUID, options = {}) => {
  console.log('\n=== Sending Duplicate Notification ===');
  console.log(`Using existing Message UUID: ${messageUUID}`);
  
  const payload = {
    ...generateNotificationPayload(options),
    messageUUID // Override with existing UUID
  };
  
  console.log(`  Submission ID: ${payload.submissionId}`);
  console.log(`  Event: ${payload.systemEventName}`);
  
  const sharedSecret = scholaroneConfig.notifications?.shared_secret;
  const headers = {};
  
  if (sharedSecret) {
    headers['x-scholarone-signature'] = generateSignature(payload, sharedSecret);
  }
  
  console.log('\nSending duplicate notification...');
  
  try {
    const response = await axios.get(
      `${API_BASE_URL}/scholarone/notifications`,
      {
        params: payload,
        headers
      }
    );
    
    console.log('\n✓ Response received:');
    console.log(`  Status: ${response.status}`);
    console.log(`  Message: ${response.data.message}`);
    console.log(`  Processed: ${response.data.processed}`);
    console.log(`  Reason: ${response.data.reason}`);
    
    if (response.data.reason === 'duplicate_message_uuid') {
      console.log('\n✓ Duplicate detection working correctly!');
    }
    
    return response.data;
  } catch (error) {
    console.error('\n✗ Error:', error.response?.data || error.message);
    throw error;
  }
};

/**
 * Check notification endpoint status
 */
const checkEndpointStatus = async (userToken) => {
  console.log('\n=== Checking Endpoint Status ===');
  
  if (!userToken) {
    console.error('Error: User token required');
    console.log('Usage: node scripts/test_scholarone_notifications.js check-status <token>');
    throw new Error('User token required');
  }
  
  try {
    const response = await axios.get(
      `${API_BASE_URL}/scholarone/notifications/status`,
      {
        headers: {
          'Authorization': `Bearer ${userToken}`
        }
      }
    );
    
    console.log('\n✓ Endpoint Status:');
    console.log(`  Enabled: ${response.data.enabled ? '✓' : '✗'}`);
    console.log(`  On Hold: ${response.data.on_hold ? '✓' : '✗'}`);
    console.log('\nNotification Types:');
    
    response.data.types.forEach(type => {
      console.log(`  - ${type.name}:`);
      console.log(`    Enabled: ${type.enabled ? '✓' : '✗'}`);
      console.log(`    Allow Retry: ${type.allowRetryOnDuplicate ? '✓' : '✗'}`);
    });
    
    return response.data;
  } catch (error) {
    console.error('\n✗ Error:', error.response?.data || error.message);
    throw error;
  }
};

/**
 * Check request status
 */
const checkRequestStatus = async (requestId) => {
  console.log('\n=== Checking Request Status ===');
  console.log(`Request ID: ${requestId}`);
  
  // We need to authenticate to check status
  // For testing, you'll need to provide a token
  const dbManager = require('../src/utils/dbManager');
  
  try {
    // Check in database
    const db = await dbManager.getDBConnection();
    
    const notification = await new Promise((resolve, reject) => {
      db.get(
        `SELECT * FROM "scholarone-notifications" WHERE request_id = ?`,
        [requestId],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });
    
    await new Promise((resolve) => {
      db.close(() => resolve());
    });
    
    if (notification) {
      console.log('\n✓ Notification Found:');
      console.log(`  Message UUID: ${notification.message_uuid}`);
      console.log(`  Submission ID: ${notification.submission_id}`);
      console.log(`  Site: ${notification.site_name}`);
      console.log(`  Event: ${notification.system_event_name}`);
      console.log(`  Processed: ${notification.processed ? '✓' : '✗'}`);
      console.log(`  Created: ${notification.created_at}`);
      console.log(`  Processed At: ${notification.processed_at || 'N/A'}`);
    } else {
      console.log('\n✗ No notification found with that request ID');
    }
    
    return notification;
  } catch (error) {
    console.error('\n✗ Error:', error.message);
    throw error;
  }
};

/**
 * Test different notification scenarios
 */
const runTestSuite = async () => {
  console.log('\n╔════════════════════════════════════════════════════════╗');
  console.log('║  ScholarOne Notifications Test Suite                  ║');
  console.log('╚════════════════════════════════════════════════════════╝');
  
  const results = {
    passed: 0,
    failed: 0,
    tests: []
  };
  
  // Test 1: Valid manuscript submission notification
  try {
    console.log('\n[TEST 1] Valid Manuscript Submission');
    const result1 = await sendTestNotification({
      siteName: scholaroneConfig.sites?.[0]?.site_name || 'test-site',
      submissionId: `TEST-${Date.now()}`,
      systemEventName: 'Author_Submit_Manuscript_Orig'
    });
    
    if (result1.processed || result1.reason === 'event_not_subscribed') {
      results.passed++;
      results.tests.push({ name: 'Valid Submission', status: 'PASS' });
    } else {
      results.failed++;
      results.tests.push({ name: 'Valid Submission', status: 'FAIL', reason: result1.reason });
    }
  } catch (error) {
    results.failed++;
    results.tests.push({ name: 'Valid Submission', status: 'ERROR', error: error.message });
  }
  
  // Wait a bit
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Test 2: Duplicate notification (same messageUUID)
  try {
    console.log('\n[TEST 2] Duplicate Notification Detection');
    const messageUUID = crypto.randomUUID();
    
    // Send first notification
    await sendTestNotification({
      siteName: scholaroneConfig.sites?.[0]?.site_name || 'test-site',
      submissionId: `TEST-DUP-${Date.now()}`,
      systemEventName: 'Author_Submit_Manuscript_Orig'
    });
    
    // Manually override to send duplicate
    const payload = generateNotificationPayload({
      siteName: scholaroneConfig.sites?.[0]?.site_name || 'test-site',
      submissionId: `TEST-DUP-${Date.now()}`,
      systemEventName: 'Author_Submit_Manuscript_Orig'
    });
    payload.messageUUID = messageUUID;
    
    // Send first
    await axios.get(`${API_BASE_URL}/scholarone/notifications`, {
      params: payload
    });
    
    // Send duplicate
    const result2 = await axios.get(`${API_BASE_URL}/scholarone/notifications`, {
      params: payload
    });
    
    if (result2.data.reason === 'duplicate_message_uuid' || !result2.data.processed) {
      results.passed++;
      results.tests.push({ name: 'Duplicate Detection', status: 'PASS' });
    } else {
      results.failed++;
      results.tests.push({ name: 'Duplicate Detection', status: 'FAIL' });
    }
  } catch (error) {
    results.failed++;
    results.tests.push({ name: 'Duplicate Detection', status: 'ERROR', error: error.message });
  }
  
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Test 3: Missing required parameters
  try {
    console.log('\n[TEST 3] Missing Required Parameters');
    const response = await axios.get(`${API_BASE_URL}/scholarone/notifications`, {
      params: {
        messageUUID: crypto.randomUUID()
        // Missing other required fields
      },
      validateStatus: () => true // Don't throw on 400
    });
    
    if (response.status === 400) {
      results.passed++;
      results.tests.push({ name: 'Missing Parameters', status: 'PASS' });
    } else {
      results.failed++;
      results.tests.push({ name: 'Missing Parameters', status: 'FAIL' });
    }
  } catch (error) {
    results.failed++;
    results.tests.push({ name: 'Missing Parameters', status: 'ERROR', error: error.message });
  }
  
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Test 4: Unsupported event type
  try {
    console.log('\n[TEST 4] Unsupported Event Type');
    const result4 = await sendTestNotification({
      siteName: scholaroneConfig.sites?.[0]?.site_name || 'test-site',
      submissionId: `TEST-UNSUP-${Date.now()}`,
      systemEventName: 'Unsupported_Event_Type'
    });
    
    if (result4.reason === 'event_not_subscribed' || !result4.processed) {
      results.passed++;
      results.tests.push({ name: 'Unsupported Event', status: 'PASS' });
    } else {
      results.failed++;
      results.tests.push({ name: 'Unsupported Event', status: 'FAIL' });
    }
  } catch (error) {
    results.failed++;
    results.tests.push({ name: 'Unsupported Event', status: 'ERROR', error: error.message });
  }
  
  // Print results
  console.log('\n\n╔════════════════════════════════════════════════════════╗');
  console.log('║  Test Results                                          ║');
  console.log('╚════════════════════════════════════════════════════════╝\n');
  
  results.tests.forEach((test, index) => {
    const statusIcon = test.status === 'PASS' ? '✓' : test.status === 'FAIL' ? '✗' : '⚠';
    console.log(`  ${statusIcon} [${index + 1}] ${test.name}: ${test.status}`);
    if (test.reason) console.log(`      Reason: ${test.reason}`);
    if (test.error) console.log(`      Error: ${test.error}`);
  });
  
  console.log(`\n  Total: ${results.tests.length} | Passed: ${results.passed} | Failed: ${results.failed}`);
  console.log('');
  
  return results;
};

/**
 * List recent notifications from database
 */
const listNotifications = async (limit = 10) => {
  console.log('\n=== Recent Notifications ===');
  
  const dbManager = require('../src/utils/dbManager');
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
    
    await new Promise((resolve) => {
      db.close(() => resolve());
    });
    
    if (notifications.length === 0) {
      console.log('\nNo notifications found');
      return;
    }
    
    console.log(`\nFound ${notifications.length} notification(s):\n`);
    
    notifications.forEach((notif, index) => {
      console.log(`[${index + 1}] ${notif.message_uuid}`);
      console.log(`    Submission: ${notif.submission_id || 'N/A'}`);
      console.log(`    Site: ${notif.site_name}`);
      console.log(`    Event: ${notif.system_event_name || 'N/A'}`);
      console.log(`    Processed: ${notif.processed ? '✓' : '✗'}`);
      console.log(`    Request ID: ${notif.request_id || 'N/A'}`);
      console.log(`    Created: ${notif.created_at}\n`);
    });
    
    return notifications;
  } catch (error) {
    await new Promise((resolve) => {
      db.close(() => resolve());
    });
    throw error;
  }
};

/**
 * Main
 */
const main = async () => {
  const [command, ...args] = process.argv.slice(2);
  
  if (!command) {
    console.log(`
╔════════════════════════════════════════════════════════╗
║  ScholarOne Notifications Testing Tool                ║
╚════════════════════════════════════════════════════════╝

Usage:
  send-notification [options]              - Send a test notification
    --site <name>                            Site name (default: first in config)
    --submission <id>                        Submission ID (default: auto-generated)
    --event <name>                           Event name (default: Author_Submit_Manuscript_Orig)
  
  send-duplicate <uuid> [options]          - Send duplicate notification
    --site <name>                            Site name
    --submission <id>                        Submission ID
  
  check-status <token>                     - Check endpoint status (requires auth)
  check-request <request_id>               - Check request by ID (direct DB query)
  
  test-suite                               - Run complete test suite
  list [limit]                             - List recent notifications (default: 10)

Examples:
  node scripts/test_scholarone_notifications.js send-notification
  node scripts/test_scholarone_notifications.js send-notification --site my-site --submission TEST-001
  node scripts/test_scholarone_notifications.js send-duplicate abc-123-def
  node scripts/test_scholarone_notifications.js check-status <your-token>
  node scripts/test_scholarone_notifications.js check-request req_abc123
  node scripts/test_scholarone_notifications.js test-suite
  node scripts/test_scholarone_notifications.js list 20
`);
    return;
  }
  
  try {
    // Parse arguments
    const parseArgs = () => {
      const options = {};
      for (let i = 0; i < args.length; i++) {
        if (args[i].startsWith('--')) {
          const key = args[i].substring(2);
          const value = args[i + 1];
          options[key] = value;
          i++;
        }
      }
      return options;
    };
    
    switch (command) {
      case 'send-notification': {
        const options = parseArgs();
        await sendTestNotification({
          siteName: options.site || scholaroneConfig.sites?.[0]?.site_name,
          submissionId: options.submission,
          systemEventName: options.event
        });
        break;
      }
      
      case 'send-duplicate': {
        const messageUUID = args[0];
        if (!messageUUID) {
          console.error('Error: Message UUID required');
          console.log('Usage: node scripts/test_scholarone_notifications.js send-duplicate <uuid>');
          throw new Error('Message UUID required');
        }
        const options = parseArgs();
        await sendDuplicateNotification(messageUUID, {
          siteName: options.site || scholaroneConfig.sites?.[0]?.site_name,
          submissionId: options.submission
        });
        break;
      }
      
      case 'check-status': {
        await checkEndpointStatus(args[0]);
        break;
      }
      
      case 'check-request': {
        await checkRequestStatus(args[0]);
        break;
      }
      
      case 'test-suite': {
        await runTestSuite();
        break;
      }
      
      case 'list': {
        const limit = args[0] ? parseInt(args[0]) : 10;
        await listNotifications(limit);
        break;
      }
      
      default:
        console.error(`Unknown command: ${command}`);
        console.log('Run without arguments to see usage');
        throw new Error(`Unknown command: ${command}`);
    }
    
    console.log('\n✓ Done\n');
  } catch (error) {
    console.error('\n✗ Error:', error.message);
    if (error.response) {
      console.error('Response:', error.response.data);
    }
    throw error;
  }
};

main();
