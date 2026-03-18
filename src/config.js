// File: src/config.js
const path = require('path');

const isTest = process.env.NODE_ENV === 'test';
const testSuffix = (name) =>
  isTest && ['aws.s3', 'users', 'permissions'].includes(name) ? '.test.json' : '.json';

module.exports = {
  port: process.env.PORT || 3000,
  jwtSecret: process.env.JWT_SECRET || 'your_jwt_secret_key',
  tokenExpiration: process.env.TOKEN_EXPIRATION || 3600, // Default: 1 hour in seconds
  permissionsConfigPath: path.join(__dirname, `../conf/permissions${testSuffix('permissions')}`),
  genshareConfigPath: path.join(__dirname, '../conf/genshare.json'),
  grobidConfigPath: path.join(__dirname, '../conf/grobid.json'),
  reportsConfigPath: path.join(__dirname, '../conf/reports.json'),
  usersPath: path.join(__dirname, `../conf/users${testSuffix('users')}`),
  emConfigPath: path.join(__dirname, '../conf/em.json'),
  scholaroneConfigPath: path.join(__dirname, '../conf/scholarone.json'),
  snapshotMailsConfigPath: path.join(__dirname, '../conf/snapshotMails.json'),
  queueManagerConfigPath: path.join(__dirname, '../conf/queueManager.json'),
  awsS3ConfigPath: path.join(__dirname, `../conf/aws.s3${testSuffix('aws.s3')}`),
  instanceConfigPath: path.join(__dirname, '../conf/instance.json'),
  googleSheetsCredentialsPath: path.join(__dirname, '../conf/googleSheets.credentials.json'),
  googleSheetsLogsConfigPath: path.join(__dirname, '../conf/googleSheets.logs.json'),
  emailAlertsConfigPath: path.join(__dirname, '../conf/emailAlerts.json'),
  smtpConfigPath: path.join(__dirname, '../conf/smtp.json')
};
