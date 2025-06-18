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

// Get all genshare request files from S3
const getAllGenshareRequestsFiles = async () => {
  try {
    console.log("Starting to fetch /genshare/request.json files from S3...");
    const prefix = `${s3Config.s3Folder}/`;
    console.log(`Using prefix: ${prefix}`);
    
    const objects = await listObjects(prefix);
    console.log(`Total objects retrieved from S3: ${objects.length}`);
    
    const requestFiles = objects.filter(obj => obj.Key.endsWith('/genshare/request.json'));
    console.log(`Total /genshare/request.json files found: ${requestFiles.length}`);
    
    const fileData = await Promise.all(requestFiles.map(async (file) => {
      try {
        const content = await getFile(file.Key);
        const pathParts = file.Key.split('/');
        
        // Extract userId and requestId from the path
        // Path format: snapshot-api-dev/userId/requestId/genshare/request.json
        const userId = pathParts[pathParts.length - 4];
        const requestId = pathParts[pathParts.length - 3];
        
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
    console.log(`Processed ${validFileData.length} valid files out of ${requestFiles.length}`);
    
    return validFileData;
  } catch (error) {
    console.error('Error getting genshare request files:', error);
    throw error;
  }
};

// Get report file from S3
const getReportFile = async (userId, requestId) => {
  try {
    const key = `${s3Config.s3Folder}/${userId}/${requestId}/report/report.json`;
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

// Get GenShare response file from S3
const getGenshareResponseFile = async (userId, requestId) => {
  try {
    const key = `${s3Config.s3Folder}/${userId}/${requestId}/genshare/response.json`;
    const content = await getFile(key);
    return JSON.parse(content);
  } catch (error) {
    if (error.$metadata?.httpStatusCode === 404 || error.name === 'NoSuchKey') {
      return null;
    }
    console.error('Error getting genshare response file:', error);
    throw error;
  }
};

// Create a ProcessingSession class to handle the accumulation of data
class ProcessingSession {
  constructor(userId, requestId = null) {
    this.userId = userId;
    this.requestId = requestId ? requestId : generateRequestId();
    this.url = generateS3Url(this.userId, this.requestId);
    this.files = []; // Internal files tracking
    this.logs = [];
    
    // Origin information
    this.origin = {
      type: 'direct', // 'direct' or 'external'
      service: null   // External service name if applicable
    };
    
    // API request/response
    this.apiRequest = null;
    this.apiResponse = null;
    
    // Services data
    this.genshare = {
      isActive: false,
      version: null,
      request: null,
      response: null
    };
    
    // Report data
    this.report = null;
    
    this.startTime = new Date();
    this.endTime = null;
    this.duration = -1;
    this.snapshotAPIVersion = "";
    this.genshareVersion = "";
    
    // Add initial log with session start
    this.addLog('[S3] Session started', 'INFO');
  }

  // Set request origin
  setOrigin(type, serviceName = null) {
    this.origin = {
      type: type,           // 'direct' or 'external'
      service: serviceName  // Service name if external
    };
    this.addLog(`[S3] Origin set: ${type}${serviceName ? ` (${serviceName})` : ''}`);
    return this;
  }

  // Version management methods
  getSnapshotAPIVersion() {
    return this.snapshotAPIVersion;
  }

  getGenshareVersion() {
    return this.genshareVersion;
  }

  setSnapshotAPIVersion(version) {
    if (!isValidVersion(version)) {
      this.snapshotAPIVersion = '';
      this.addLog(`[S3] Invalid Snapshot API Version format: ${version}. Setting empty string.`, 'WARN');
      return;
    }
    this.snapshotAPIVersion = version;
    this.addLog(`[S3] Snapshot API Version set to: ${version}`, 'INFO');
  }

  setGenshareVersion(version) {
    if (!isValidVersion(version)) {
      this.genshareVersion = '';
      this.addLog(`[S3] Invalid Genshare Version format: ${version}. Setting empty string.`, 'WARN');
      return;
    }
    this.genshareVersion = version;
    this.addLog(`[S3] Genshare Version set to: ${version}`, 'INFO');
  }
  
  // Store API request (from client)
  setAPIRequest(request) {
    this.apiRequest = request;
    this.addLog('[S3] API request stored', 'INFO');
    return this;
  }
  
  // Store API response (to client)
  setAPIResponse(response) {
    this.apiResponse = response;
    this.addLog('[S3] API response stored', 'INFO');
    return this;
  }
  
  // Initialize GenShare service
  initGenShare(version = null) {
    this.genshare.isActive = true;
    this.genshare.version = version;
    this.addLog(`[S3] GenShare service activated${version ? ` (version ${version})` : ''}`, 'INFO');
    return this;
  }

  // Path management
  getBasePath() {
    return `${s3Config.s3Folder}/${this.userId}/${this.requestId}`;
  }

  // Logging
  addLog(entry, level = 'INFO') {
    const timestamp = formatLogDate(new Date());
    this.logs.push(`[${timestamp}] [${level}] ${entry}`);
  }

  // Set Genshare request
  setGenshareRequest(request) {
    if (!this.genshare.isActive) {
      this.initGenShare();
    }
    this.genshare.request = request;
    this.addLog(`[S3] Genshare request setup`, 'INFO');
    return this;
  }

  // Set Genshare response
  setGenshareResponse(response) {
    if (!this.genshare.isActive) {
      this.initGenShare();
    }
    this.genshare.response = response;
    this.addLog(`[S3] Genshare response setup`, 'INFO');
    return this;
  }
  
  // Set report data
  setReport(reportData) {
    this.report = reportData;
    this.addLog(`[S3] Report data setup`, 'INFO');
    return this;
  }
  
  setServiceResponse(serviceName, response) {
    if (serviceName === 'genshare') {
      return this.setGenshareResponse(response);
    } else if (serviceName === 'editorial-manager') {
      this.setAPIResponse(response);
    }
    this.addLog(`[S3] ${serviceName} response setup`, 'INFO');
    return this;
  }
  
  // Add a file to the session
  addFile(file, origin = 'api') {
    if (!file) return this;
    
    // Add file with metadata
    this.files.push({
      path: file.path,
      originalname: file.originalname,
      mimetype: file.mimetype,
      size: file.size,
      origin: origin
    });
    
    this.addLog(`[S3] Added file: ${file.originalname} (${file.size} bytes, origin: ${origin})`, 'INFO');
    return this;
  }

  getDuration() {
    if (this.duration > 0) return this.duration;
    return new Date() - this.startTime;
  }

  async saveToS3() {
    try {
      // Add session end time to logs
      this.endTime = new Date();
      this.duration = this.endTime - this.startTime;
      this.addLog(`[S3] Session ended - Duration: ${this.duration}ms`, 'INFO');

      // Prepare files for batch upload
      const filesToUpload = [];

      // Prepare process metadata
      const processMetadata = {
        startDate: formatLogDate(this.startTime),
        endDate: formatLogDate(this.endTime),
        duration: `${this.duration}ms`,
        snapshotAPIVersion: this.snapshotAPIVersion,
        genshareVersion: this.genshareVersion,
        origin: this.origin,
        services: {
          genshare: this.genshare.isActive
        }
      };

      // Add process files
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

      // Add API request/response
      if (this.apiRequest) {
        filesToUpload.push({
          key: `${this.getBasePath()}/request.json`,
          data: JSON.stringify(this.apiRequest, null, 2),
          contentType: 'application/json'
        });
      }
      
      if (this.apiResponse) {
        filesToUpload.push({
          key: `${this.getBasePath()}/response.json`,
          data: JSON.stringify(this.apiResponse, null, 2),
          contentType: 'application/json'
        });
      }

      // Add report data if it exists
      if (this.report) {
        filesToUpload.push({
          key: `${this.getBasePath()}/report/report.json`,
          data: JSON.stringify(this.report, null, 2),
          contentType: 'application/json'
        });
      }

      // Process files
      if (this.files.length > 0) {
        const filesMetadata = this.files.map((file, index) => ({
          id: index + 1,
          originalName: file.originalname,
          size: file.size,
          mimeType: file.mimetype,
          origin: file.origin
        }));
        
        filesToUpload.push({
          key: `${this.getBasePath()}/files.json`,
          data: JSON.stringify(filesMetadata, null, 2),
          contentType: 'application/json'
        });
        
        // Upload each file
        for (let i = 0; i < this.files.length; i++) {
          const file = this.files[i];
          const fileIndex = i + 1; // Start from 1
          const fileExtension = file.originalname.split('.').pop();
          
          // Calculate MD5 hash for the file
          const md5Hash = await calculateMD5(file.path);
          
          // Prepare file metadata
          const fileMetadata = {
            originalName: file.originalname,
            size: file.size,
            md5: md5Hash,
            mimeType: file.mimetype,
            origin: file.origin
          };
          
          // Add file metadata
          filesToUpload.push({
            key: `${this.getBasePath()}/files/file_${fileIndex}.metadata.json`,
            data: JSON.stringify(fileMetadata, null, 2),
            contentType: 'application/json'
          });
          
          // Add the actual file
          filesToUpload.push({
            key: `${this.getBasePath()}/files/file_${fileIndex}.${fileExtension}`,
            data: createReadStream(file.path),
            contentType: file.mimetype
          });
        }
      }

      // Process GenShare service
      if (this.genshare.isActive) {
        // Store GenShare metadata
        const genshareMetadata = {
          version: this.genshare.version,
          isActive: true
        };
        
        filesToUpload.push({
          key: `${this.getBasePath()}/genshare/metadata.json`,
          data: JSON.stringify(genshareMetadata, null, 2),
          contentType: 'application/json'
        });
        
        // Store request data if it exists
        if (this.genshare.request) {
          filesToUpload.push({
            key: `${this.getBasePath()}/genshare/request.json`,
            data: JSON.stringify(this.genshare.request, null, 2),
            contentType: 'application/json'
          });
        }
        
        // Store response data if it exists
        if (this.genshare.response) {
          filesToUpload.push({
            key: `${this.getBasePath()}/genshare/response.json`,
            data: JSON.stringify(this.genshare.response, null, 2),
            contentType: 'application/json'
          });
        }
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
  getAllGenshareRequestsFiles,
  getReportFile,
  getGenshareResponseFile,
  generateRequestId,
  uploadBatchToS3
};
