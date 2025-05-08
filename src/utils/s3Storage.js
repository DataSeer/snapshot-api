// File: src/utils/s3Storage.js
const { 
  S3Client, 
  PutObjectCommand, 
  ListObjectsV2Command, 
  GetObjectCommand
} = require('@aws-sdk/client-s3');
const { createReadStream } = require('fs');
const crypto = require('crypto');
const fs = require('fs');

const { isValidVersion } = require('./versions');

// Load S3 configuration from JSON file
// eslint-disable-next-line node/no-unpublished-require
const s3Config = require('../../conf/aws.s3.json');

// Initialize S3 client
const s3Client = new S3Client({
  credentials: {
    accessKeyId: s3Config.accessKeyId,
    secretAccessKey: s3Config.secretAccessKey,
  },
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
    await Promise.all(files.map(async ({ key, data, contentType }) => {
      const params = {
        Bucket: s3Config.bucketName,
        Key: key,
        Body: data,
        ContentType: contentType
      };
      const command = new PutObjectCommand(params);
      return s3Client.send(command);
    }));
  } catch (error) {
    console.error('Error in batch upload:', error);
    throw error;
  }
};

// List all objects in a prefix with pagination
const listObjects = async (prefix) => {
  let allObjects = [];
  let continuationToken = undefined;
  
  do {
    const params = {
      Bucket: s3Config.bucketName,
      Prefix: prefix,
      ContinuationToken: continuationToken
    };
    
    const command = new ListObjectsV2Command(params);
    const response = await s3Client.send(command);
    allObjects = [...allObjects, ...(response.Contents || [])];
    continuationToken = response.NextContinuationToken;
    
    console.log(`Retrieved ${response.Contents?.length || 0} objects, ${allObjects.length} total so far.`);
    
  } while (continuationToken);
  
  return allObjects;
};

// Get file from S3
const getFile = async (key) => {
  try {
    const params = {
      Bucket: s3Config.bucketName,
      Key: key
    };
    
    const command = new GetObjectCommand(params);
    const response = await s3Client.send(command);
    
    // In v3, Body is a readable stream
    return await streamToString(response.Body);
  } catch (error) {
    console.error(`Error getting file ${key}:`, error);
    throw error;
  }
};

// Helper function to convert stream to string
const streamToString = async (stream) => {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf-8');
};

// Get all options.json files from S3
const getAllOptionsFiles = async () => {
  try {
    console.log("Starting to fetch options files from S3...");
    const prefix = `${s3Config.s3Folder}/`;
    console.log(`Using prefix: ${prefix}`);
    
    const objects = await listObjects(prefix);
    console.log(`Total objects retrieved from S3: ${objects.length}`);
    
    const optionsFiles = objects.filter(obj => obj.Key.endsWith('/options.json'));
    console.log(`Total options.json files found: ${optionsFiles.length}`);
    
    const fileData = await Promise.all(optionsFiles.map(async (file) => {
      try {
        const content = await getFile(file.Key);
        const pathParts = file.Key.split('/');
        
        // Extract userId and requestId from the path
        // Path format: snapshot-api-dev/userId/requestId/options.json
        const userId = pathParts[pathParts.length - 3];
        const requestId = pathParts[pathParts.length - 2];
        
        let parsedContent;
        try {
          parsedContent = JSON.parse(content);
        } catch (e) {
          console.error(`JSON parse error for ${file.Key}:`, e);
          parsedContent = null;
        }
        
        return {
          userId,
          requestId,
          content: parsedContent,
          lastModified: file.LastModified
        };
      } catch (error) {
        console.error(`Error processing file ${file.Key}:`, error);
        return null;
      }
    }));
    
    // Filter out any null entries from errors
    const validFileData = fileData.filter(file => file !== null);
    console.log(`Processed ${validFileData.length} valid files out of ${optionsFiles.length}`);
    
    return validFileData;
  } catch (error) {
    console.error('Error getting options files:', error);
    throw error;
  }
};


// Get report file from S3
const getReportFile = async (userId, requestId) => {
  try {
    const key = `${s3Config.s3Folder}/${userId}/${requestId}/report.json`;
    const content = await getFile(key);
    return JSON.parse(content);
  } catch (error) {
    if (error.$metadata?.httpStatusCode === 404 || error.name === 'NoSuchKey') {
      return null;
    }
    console.error('Error getting report file:', error);
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
    this.report = null;
    this.options = null;
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
    if (!isValidVersion(version)) {
      this.snapshotAPIVersion = '';
      this.addLog(`Invalid Snapshot API Version format: ${version}. Setting empty string.`, 'WARN');
      return;
    }
    this.snapshotAPIVersion = version;
    this.addLog(`Snapshot API Version set to: ${version}`, 'INFO');
  }

  setGenshareVersion(version) {
    if (!isValidVersion(version)) {
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

  setReport(report) {
    this.report = report;
    this.addLog(`report JSON data setup`, 'INFO');
  }

  setOptions(options) {
    this.options = options;
    this.addLog(`options JSON data setup`, 'INFO');
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
            data: createReadStream(this.file.path),
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

      // Add report if it exists
      if (this.report) {
        filesToUpload.push({
          key: `${this.getBasePath()}/report.json`,
          data: JSON.stringify(this.report, null, 2),
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

module.exports = { 
  ProcessingSession,
  getAllOptionsFiles,
  getReportFile
};
