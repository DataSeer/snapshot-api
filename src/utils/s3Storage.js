// File: src/utils/s3Storage.js
const AWS = require('aws-sdk');
const crypto = require('crypto');
const fs = require('fs');

// Load S3 configuration from JSON file
// eslint-disable-next-line node/no-unpublished-require
const s3Config = require('../../conf/aws.s3.json');

const versionRegex = /^v[0-9]+\.[0-9]+\.[0-9]+$/;

// Initialize S3 client
const s3 = new AWS.S3({
  accessKeyId: s3Config.accessKeyId,
  secretAccessKey: s3Config.secretAccessKey,
  region: s3Config.region
});

// Generate S3 URL
const generateS3Url = (userId, requestId) => {
  return `https://s3.console.aws.amazon.com/s3/buckets/${s3Config.bucketName}?region=${s3Config.region}&bucketType=general&prefix=${s3Config.s3Folder}/${userId}/${requestId}/`;
}

// Generate unique request ID
const generateRequestId = () => {
  return crypto.randomBytes(16).toString('hex');
};

// Format date for logging
const formatLogDate = (date) => {
  return date.toISOString().replace('T', ' ').replace('Z', '');
};

// Calculate MD5 hash of a file
const calculateMD5 = (filePath) => {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('md5');
    const stream = fs.createReadStream(filePath);
    
    stream.on('data', data => hash.update(data));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', error => reject(error));
  });
};

// Store multiple files in S3 with a single batch
const uploadBatchToS3 = async (files) => {
  try {
    await Promise.all(files.map(({ key, data, contentType }) => {
      const params = {
        Bucket: s3Config.bucketName,
        Key: key,
        Body: data,
        ContentType: contentType
      };
      return s3.upload(params).promise();
    }));
  } catch (error) {
    console.error('Error in batch upload:', error);
    throw error;
  }
};

// Create a ProcessingSession class to handle the accumulation of data
class ProcessingSession {
  constructor(userId, file = null) {
    this.userId = userId;
    this.requestId = generateRequestId();
    this.url = generateS3Url(this.userId, this.requestId);
    this.file = file;
    this.logs = [];
    this.response = null;
    this.startTime = new Date();
    this.endTime = null;
    this.duration = -1;
    this.snapshotAPIVersion = "";
    this.genshareVersion = "";
    
    // Add initial log with session start
    this.addLog('Session started', 'INFO');
    if (!file) {
      this.addLog('No file provided in this session', 'INFO');
    }
  }

  getSnapshotAPIVersion() {
    return this.snapshotAPIVersion;
  }

  getGenshareVersion() {
    return this.genshareVersion;
  }

  setSnapshotAPIVersion(version) {
    if (!versionRegex.test(version)) {
      this.snapshotAPIVersion = '';
      this.addLog(`Invalid Snapshot API Version format: ${version}. Setting empty string.`, 'WARN');
      return;
    }
    this.snapshotAPIVersion = version;
    this.addLog(`Snapshot API Version set to: ${version}`, 'INFO');
  }

  setGenshareVersion(version) {
    if (!versionRegex.test(version)) {
      this.genshareVersion = '';
      this.addLog(`Invalid Genshare Version format: ${version}. Setting empty string.`, 'WARN');
      return;
    }
    this.genshareVersion = version;
    this.addLog(`Genshare Version set to: ${version}`, 'INFO');
  }

  getBasePath() {
    return `${s3Config.s3Folder}/${this.userId}/${this.requestId}`;
  }

  addLog(entry, level = 'INFO') {
    const timestamp = formatLogDate(new Date());
    this.logs.push(`[${timestamp}] [${level}] ${entry}`);
  }

  setResponse(response) {
    this.response = response;
    this.addLog(`Response status: ${response.status}`, 'INFO');
  }

  async saveToS3() {
    try {
      // Add session end time to logs
      this.endTime = new Date();
      this.duration = this.endTime - this.startTime;
      this.addLog(`Session ended - Duration: ${this.duration}ms`, 'INFO');

      // Prepare files for batch upload
      const filesToUpload = [];

      // Add file and file metadata if file exists
      if (this.file) {
        // Calculate MD5 hash only if file exists
        const md5Hash = await calculateMD5(this.file.path);
        
        // Prepare file metadata
        const fileMetadata = {
          originalName: this.file.originalname,
          size: this.file.size,
          md5: md5Hash,
          mimeType: this.file.mimetype
        };

        // Add file and its metadata to upload batch
        filesToUpload.push(
          {
            key: `${this.getBasePath()}/file.pdf`,
            data: fs.createReadStream(this.file.path),
            contentType: 'application/pdf'
          },
          {
            key: `${this.getBasePath()}/file.metadata.json`,
            data: JSON.stringify(fileMetadata, null, 2),
            contentType: 'application/json'
          }
        );
      }

      // Prepare process metadata
      const processMetadata = {
        startDate: formatLogDate(this.startTime),
        endDate: formatLogDate(this.endTime),
        duration: `${this.duration}ms`,
        hasFile: !!this.file,
        snapshotAPIVersion: this.snapshotAPIVersion,
        genshareVersion: this.genshareVersion
      };

      // Add common files that don't depend on this.file
      filesToUpload.push(
        {
          key: `${this.getBasePath()}/process.json`,
          data: JSON.stringify(processMetadata, null, 2),
          contentType: 'application/json'
        },
        {
          key: `${this.getBasePath()}/process.log`,
          data: this.logs.join('\n'),
          contentType: 'text/plain'
        }
      );

      // Add options if they exist
      if (this.options) {
        filesToUpload.push({
          key: `${this.getBasePath()}/options.json`,
          data: JSON.stringify(this.options, null, 2),
          contentType: 'application/json'
        });
      }

      // Add response if it exists
      if (this.response) {
        filesToUpload.push({
          key: `${this.getBasePath()}/response.json`,
          data: JSON.stringify(this.response, null, 2),
          contentType: 'application/json'
        });
      }

      // Upload everything in a single batch
      await uploadBatchToS3(filesToUpload);

      return this.requestId;
    } catch (error) {
      console.error('Error saving processing session:', error);
      throw error;
    }
  }
}

module.exports = { ProcessingSession };
