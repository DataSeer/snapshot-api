// File: src/utils/s3Storage.js with Editorial Manager extensions
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
  constructor(userId) {
    this.userId = userId;
    this.requestId = generateRequestId();
    this.url = generateS3Url(this.userId, this.requestId);
    this.file = null;
    this.files = []; // Internal files tracking
    this.logs = [];
    this.response = null;
    this.report = null;
    this.options = null;
    this.startTime = new Date();
    this.endTime = null;
    this.duration = -1;
    this.snapshotAPIVersion = "";
    this.genshareVersion = "";
    this.externalService = null; // Will store external service data (e.g., Editorial Manager)
    
    // Add initial log with session start
    this.addLog('[S3] Session started', 'INFO');
  }

  // Version management methods
  getSnapshotAPIVersion() {
    return this.snapshotAPIVersion;
  }

  getGenshareVersion() {
    return this.genshareVersion;
  }

  getExternalServiceType() {
    return this.externalService ? this.externalService.type : null;
  }

  getExternalServiceVersion() {
    return this.externalService ? this.externalService.version : null;
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
  
  setExternalService(type, version = null) {
    this.externalService = { 
      type,
      version: version || null,
      data: {},
      files: [] // Track external service files separately
    };
    this.addLog(`[S3] External service set to: ${type}${version ? ` (version ${version})` : ''}`, 'INFO');
  }

  // Set external service data
  setExternalServiceData(key, value) {
    if (!this.externalService) {
      this.addLog('[S3] Warning: No external service set, cannot store data', 'WARN');
      return;
    }
    this.externalService.data[key] = value;
    this.addLog(`[S3] External service data set: ${key}`, 'INFO');
  }

  // Path management
  getBasePath() {
    return `${s3Config.s3Folder}/${this.userId}/${this.requestId}`;
  }
  
  getExternalServicePath() {
    if (!this.externalService) {
      return null;
    }
    return `${this.getBasePath()}/${this.externalService.type}`;
  }

  // Logging
  addLog(entry, level = 'INFO') {
    const timestamp = formatLogDate(new Date());
    this.logs.push(`[${timestamp}] [${level}] ${entry}`);
  }

  // Response handling
  setResponse(response) {
    this.response = response;
    this.addLog(`[S3] Response status: ${response.status}`, 'INFO');
  }

  setReport(report) {
    this.report = report;
    this.addLog(`[S3] report JSON data setup`, 'INFO');
  }

  setFile(file) {
    this.file = file;
    this.files.push(file);
    this.addLog(`[S3] file setup`, 'INFO');
  }

  setOptions(options) {
    this.options = options;
    this.addLog(`[S3] options JSON data setup`, 'INFO');
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
        hasFile: !!this.file,
        snapshotAPIVersion: this.snapshotAPIVersion,
        genshareVersion: this.genshareVersion,
        externalService: this.externalService ? {
          type: this.externalService.type,
          version: this.externalService.version
        } : null
      };

      // Add process metadata
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
        
        // For external service, also store the request body in the appropriate path
        if (this.externalService) {
          // Store options in external service path
          filesToUpload.push({
            key: `${this.getExternalServicePath()}/request.json`,
            data: JSON.stringify(this.options, null, 2),
            contentType: 'application/json'
          });
          
          // Store any external service specific data
          if (Object.keys(this.externalService.data).length > 0) {
            for (const [key, value] of Object.entries(this.externalService.data)) {
              filesToUpload.push({
                key: `${this.getExternalServicePath()}/${key}/response.json`,
                data: JSON.stringify(value, null, 2),
                contentType: 'application/json'
              });
            }
          }
        }
      }

      // Add response if it exists
      if (this.response) {
        filesToUpload.push({
          key: `${this.getBasePath()}/response.json`,
          data: JSON.stringify(this.response, null, 2),
          contentType: 'application/json'
        });
        
        // For external service, also store the response in the appropriate path
        if (this.externalService) {
          filesToUpload.push({
            key: `${this.getExternalServicePath()}/response.json`,
            data: JSON.stringify(this.response, null, 2),
            contentType: 'application/json'
          });
        }
      }

      // Add report if it exists
      if (this.report) {
        filesToUpload.push({
          key: `${this.getBasePath()}/report.json`,
          data: JSON.stringify(this.report, null, 2),
          contentType: 'application/json'
        });
      }
      
      // Handle internal files (GenShare files)
      for (let i = 0; i < this.files.length; i++) {
        const currentFile = this.files[i];
        if (currentFile) {
          // Calculate MD5 hash
          const md5Hash = await calculateMD5(currentFile.path);
          
          // Prepare file metadata
          const fileMetadata = {
            originalName: currentFile.originalname,
            size: currentFile.size,
            md5: md5Hash,
            mimeType: currentFile.mimetype
          };
  
          // Add file and its metadata at the root
          const fileKey = i === 0 ? 'file' : `file_${i}`;
          
          filesToUpload.push(
            {
              key: `${this.getBasePath()}/${fileKey}.${currentFile.originalname.split('.').pop()}`,
              data: createReadStream(currentFile.path),
              contentType: currentFile.mimetype
            },
            {
              key: `${this.getBasePath()}/${fileKey}.metadata.json`,
              data: JSON.stringify(fileMetadata, null, 2),
              contentType: 'application/json'
            }
          );
        }
      }
      
      // Handle external service files if any exist
      if (this.externalService && this.externalService.files.length > 0) {
        // Create a files.json with metadata for all external files
        const externalFilesMetadata = this.externalService.files.map((file, index) => ({
          id: index + 1,
          originalName: file.originalname,
          size: file.size,
          mimeType: file.mimetype,
          fieldname: file.fieldname || null
        }));
        
        filesToUpload.push({
          key: `${this.getExternalServicePath()}/files.json`,
          data: JSON.stringify(externalFilesMetadata, null, 2),
          contentType: 'application/json'
        });
        
        // Upload each external file with numeric naming convention
        for (let i = 0; i < this.externalService.files.length; i++) {
          const externalFile = this.externalService.files[i];
          const fileIndex = i + 1; // Start from 1
          const fileExtension = externalFile.originalname.split('.').pop();
          
          filesToUpload.push({
            key: `${this.getExternalServicePath()}/${fileIndex}.${fileExtension}`,
            data: createReadStream(externalFile.path),
            contentType: externalFile.mimetype
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
  
  // Add an internal file to the session (GenShare files)
  addFile(file) {
    if (file) {
      this.files.push(file);
      this.addLog(`[S3] Added internal file: ${file.originalname} (${file.size} bytes)`, 'INFO');
    }
    return this;
  }
  
  // Add an external file to the session (External Service files)
  addExternalFile(file) {
    if (!this.externalService) {
      this.addLog('[S3] Warning: No external service set, cannot add external file', 'WARN');
      return this;
    }
    
    if (file) {
      this.externalService.files.push(file);
      this.addLog(`[S3] Added external file for ${this.externalService.type}: ${file.originalname} (${file.size} bytes)`, 'INFO');
    }
    return this;
  }
}

module.exports = { 
  ProcessingSession,
  getAllOptionsFiles,
  getReportFile,
  generateRequestId,
  uploadBatchToS3
};
