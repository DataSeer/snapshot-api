// File: src/config.js
const path = require('path');

const configSuffix = process.env.NODE_ENV === 'test' ? '.test.json' : '.json';

module.exports = {
  port: process.env.PORT || 3000,
  jwtSecret: process.env.JWT_SECRET || 'your_jwt_secret_key',
  tokenExpiration: process.env.TOKEN_EXPIRATION || 3600, // Default: 1 hour in seconds
  permissionsConfigPath: path.join(__dirname, `../conf/permissions${configSuffix}`),
  genshareConfigPath: path.join(__dirname, `../conf/genshare${configSuffix}`),
  grobidConfigPath: path.join(__dirname, `../conf/grobid${configSuffix}`),
  datastetConfigPath: path.join(__dirname, `../conf/datastet${configSuffix}`),
  reportsConfigPath: path.join(__dirname, `../conf/reports${configSuffix}`),
  usersPath: path.join(__dirname, `../conf/users${configSuffix}`),
  emConfigPath: path.join(__dirname, `../conf/em${configSuffix}`),
  scholaroneConfigPath: path.join(__dirname, `../conf/scholarone${configSuffix}`),
  snapshotMailsConfigPath: path.join(__dirname, `../conf/snapshotMails${configSuffix}`),
  queueManagerConfigPath: path.join(__dirname, `../conf/queueManager${configSuffix}`),
  awsS3ConfigPath: path.join(__dirname, `../conf/aws.s3${configSuffix}`),
  googleSheetsCredentialsPath: path.join(__dirname, `../conf/googleSheets.credentials${configSuffix}`)
};
