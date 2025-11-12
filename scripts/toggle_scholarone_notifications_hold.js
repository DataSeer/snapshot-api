// File: scripts/toggle_scholarone_notifications_hold.js
const scholaroneNotificationsManager = require('../src/utils/scholaroneNotificationsManager');

const command = process.argv[2];

const main = async () => {
  try {
    const notificationsConfig = scholaroneNotificationsManager.loadNotificationsConfig();
    
    switch (command) {
      case 'on':
      case 'enable':
      case 'hold': {
        scholaroneNotificationsManager.toggleEndpointOnHold(true);
        console.log('✓ ScholarOne notifications endpoint is now ON HOLD');
        console.log('  ScholarOne will queue notifications until hold is lifted');
        break;
      }
      
      case 'off':
      case 'disable':
      case 'resume': {
        scholaroneNotificationsManager.toggleEndpointOnHold(false);
        console.log('✓ ScholarOne notifications endpoint is now ACTIVE');
        console.log('  Queued notifications will be delivered');
        break;
      }
      
      case 'status': {
        const isOnHold = notificationsConfig.endpoint_on_hold || false;
        const isEnabled = notificationsConfig.enabled || false;
        
        console.log('\nScholarOne Notifications Status:');
        console.log(`  Enabled: ${isEnabled ? '✓ Yes' : '✗ No'}`);
        console.log(`  On Hold: ${isOnHold ? '✓ Yes (notifications queued)' : '✗ No (accepting notifications)'}`);
        console.log(`\nConfigured notification types:`);
        
        const types = notificationsConfig.types || {};
        Object.entries(types).forEach(([typeName, typeConfig]) => {
          console.log(`  - ${typeName}: ${typeConfig.enabled ? '✓ Enabled' : '✗ Disabled'}`);
          console.log(`    Allow retry: ${typeConfig.allowRetryOnDuplicate ? 'Yes' : 'No'}`);
          console.log(`    Events: ${typeConfig.events.join(', ') || 'None'}`);
        });
        break;
      }
      
      default: {
        console.log('ScholarOne Notifications On-Hold Management');
        console.log('\nUsage:');
        console.log('  npm run scholarone:hold:on      - Put endpoint on hold (queue notifications)');
        console.log('  npm run scholarone:hold:off     - Resume endpoint (process notifications)');
        console.log('  npm run scholarone:hold:status  - Check current status');
        console.log('\nAliases:');
        console.log('  on, enable, hold    - Put on hold');
        console.log('  off, disable, resume - Resume processing');
        break;
      }
    }
  } catch (error) {
    console.error('Error:', error.message);
    throw error;
  }
};

main();
