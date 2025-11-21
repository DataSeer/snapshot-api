// File: src/utils/queueManager.js
const EventEmitter = require('events');
const dbManager = require('./dbManager');
const config = require('../config');

// Load queue manager configuration
const queueConfig = require(config.queueManagerConfigPath);

// Create event emitter for job status changes
const jobEventEmitter = new EventEmitter();

// Remove undefined values (where environment variables weren't set)
Object.keys(queueConfig).forEach(key => {
  if (queueConfig[key] === undefined) {
    delete queueConfig[key];
  }
});

/**
 * Job status enum
 */
const JobStatus = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
  RETRYING: 'retrying'
};

/**
 * Job types enum
 */
const JobType = {
  EM_SUBMISSION: 'em_submission',
  MAIL_SUBMISSION: 'mail_submission', // Added for snapshot-mails
  SCHOLARONE_SUBMISSION: 'scholarone_submission', // Added for ScholarOne
  // Add more job types here if needed
};

/**
 * Job priority enum
 */
const JobPriority = {
  LOW: queueConfig.jobPriorities.LOW || 1,
  NORMAL: queueConfig.jobPriorities.NORMAL || 5,
  HIGH: queueConfig.jobPriorities.HIGH || 10,
  CRITICAL: queueConfig.jobPriorities.CRITICAL || 20
};

// Store processor functions by job ID
const processorFunctions = new Map();

// Store job completion callbacks
const completionCallbacks = new Map();

// Track currently running jobs
let activeJobs = 0;

/**
 * Initialize the queue database
 */
const initQueueDatabase = async () => {
  try {
    // Use dbManager's initDatabase which now includes the processing_jobs table
    await dbManager.initDatabase();
    console.log('Queue database initialized successfully');
  } catch (error) {
    console.error('Error initializing queue database:', error);
    throw error;
  }
};

/**
 * Register a callback to be executed when a job reaches a specific status
 * @param {string} requestId - Request ID of the job
 * @param {string} status - Status to watch for (e.g., 'completed', 'failed')
 * @param {Function} callback - Callback function to execute
 */
const onJobStatusChange = (requestId, status, callback) => {
  const eventName = `job:${requestId}:${status}`;
  jobEventEmitter.once(eventName, callback);
};

/**
 * Register a callback to be executed when a job completes (success or failure)
 * @param {string} requestId - Request ID of the job
 * @param {Function} callback - Callback function to execute with (error, result)
 */
const onJobComplete = (requestId, callback) => {
  completionCallbacks.set(requestId, callback);
};

/**
 * Emit job status change event and execute callbacks
 * @param {string} requestId - Request ID of the job
 * @param {string} status - New status
 * @param {Object} data - Additional data (error, result, etc.)
 */
const emitJobStatusChange = async (requestId, status, data = {}) => {
  // Emit event for listeners
  const eventName = `job:${requestId}:${status}`;
  jobEventEmitter.emit(eventName, { requestId, status, ...data });
  
  // Handle completion callback
  if (status === JobStatus.COMPLETED || status === JobStatus.FAILED) {
    const callback = completionCallbacks.get(requestId);
    if (callback && typeof callback === 'function') {
      try {
        if (status === JobStatus.COMPLETED) {
          await callback(null, data.result);
        } else {
          await callback(new Error(data.error || 'Job failed'), null);
        }
      } catch (callbackError) {
        console.error(`Error executing completion callback for job ${requestId}:`, callbackError);
      } finally {
        // Clean up callback
        completionCallbacks.delete(requestId);
      }
    }
  }
};

/**
 * Add a job to the processing queue
 * @param {string} requestId - Unique request ID for the job
 * @param {string} jobType - Type of job (from JobType enum)
 * @param {Object} data - Job data (will be stored as JSON)
 * @param {number} maxRetries - Maximum number of retries (default from config)
 * @param {number} priority - Job priority (default: NORMAL)
 * @param {Function} processorFunction - Function to process this job
 * @param {Function} onComplete - Optional callback when job completes
 * @returns {Promise<Object>} - Created job record
 */
const enqueueJob = async (requestId, jobType, data, maxRetries = queueConfig.maxRetries, priority = JobPriority.NORMAL, processorFunction, onComplete) => {
  try {
    // Store the job in the database using dbManager
    const job = await dbManager.addJobToQueue(requestId, jobType, data, maxRetries, priority);
    
    // If a processor function was provided, store it
    if (typeof processorFunction === 'function') {
      processorFunctions.set(requestId, processorFunction);
    }
    
    // If a completion callback was provided, store it
    if (typeof onComplete === 'function') {
      completionCallbacks.set(requestId, onComplete);
    }
    
    // Emit job created event
    await emitJobStatusChange(requestId, JobStatus.PENDING, { job });
    
    // Immediately start processing the job in the background
    // We intentionally don't await this to allow the API to respond immediately
    processNextJob();
    
    return job;
  } catch (error) {
    console.error(`Error enqueuing job (${requestId}):`, error);
    throw error;
  }
};

/**
 * Process the next job in the queue
 * @returns {Promise<boolean>} - True if a job was processed
 */
const processNextJob = async () => {
  // Check if we're already at max concurrent jobs
  if (activeJobs >= queueConfig.maxConcurrentJobs) {
    return false;
  }
  
  let job = null;
  
  try {
    // Get the next job to process from dbManager
    job = await dbManager.getNextPendingJob();
    
    if (!job) {
      // No pending jobs
      return false;
    }
    
    // Increment active jobs counter
    activeJobs++;
    
    // Mark job as processing
    await dbManager.updateJobStatus(job.request_id, JobStatus.PROCESSING);
    
    // Emit processing event
    await emitJobStatusChange(job.request_id, JobStatus.PROCESSING, { job });
    
    console.log(`[Queue] Processing job ${job.id} (${job.request_id}) - Active jobs: ${activeJobs}/${queueConfig.maxConcurrentJobs}`);
    
    // Get the processor function for this job
    let processorFunction = processorFunctions.get(job.request_id);
    
    // If no processor function is found, look for one based on job type (fallback)
    if (!processorFunction) {
      // Log a warning that specific processor wasn't found
      console.warn(`[Queue] No specific processor found for job ${job.id} (${job.request_id}). Using job type lookup.`);
      
      // This could be extended with a registry of processor functions by job type
      switch (job.job_type) {
        case 'em_submission':
          try {
            // Try to dynamically require the emManager to avoid circular dependencies
            const emManager = require('./emManager');
            processorFunction = emManager.processEmSubmissionJob;
          } catch (error) {
            throw new Error(`Could not load processor for job type ${job.job_type}: ${error.message}`);
          }
          break;
        case 'mail_submission':
          try {
            // Try to dynamically require the snapshotMailsManager to avoid circular dependencies
            const snapshotMailsManager = require('./snapshotMailsManager');
            processorFunction = snapshotMailsManager.processMailSubmissionJob;
          } catch (error) {
            throw new Error(`Could not load processor for job type ${job.job_type}: ${error.message}`);
          }
          break;
        case 'scholarone_submission':
          try {
            // Try to dynamically require the scholaroneManager to avoid circular dependencies
            const scholaroneManager = require('./scholaroneManager');
            processorFunction = scholaroneManager.processScholaroneSubmissionJob;
          } catch (error) {
            throw new Error(`Could not load processor for job type ${job.job_type}: ${error.message}`);
          }
          break;
        default:
          throw new Error(`Unknown job type: ${job.job_type}`);
      }
    }
    
    // Ensure we have a processor function
    if (typeof processorFunction !== 'function') {
      throw new Error(`No processor function available for job ${job.id} (${job.request_id})`);
    }
    
    // Process the job with the processor function
    const result = await processorFunction(job);
    
    // Mark job as completed in database FIRST
    await dbManager.updateJobStatus(job.request_id, JobStatus.COMPLETED, null, result);
    
    // THEN emit the completion event (ensures DB is updated before callbacks)
    await emitJobStatusChange(job.request_id, JobStatus.COMPLETED, { job, result });
    
    // Clean up the processor function from memory
    processorFunctions.delete(job.request_id);
    
    console.log(`[Queue] Job ${job.id} (${job.request_id}) completed successfully`);
    
    // Decrement active jobs counter
    activeJobs--;
    
    // Process next job (non-blocking) - we can start another job since one has completed
    setTimeout(() => processNextJob(), 0);
    
    return true;
  } catch (error) {
    if (!job) {
      console.error('[Queue] Error in job processing:', error);
      return false;
    }
    
    console.error(`[Queue] Error processing job ${job.id} (${job.request_id}):`, error);
    
    // Check if we should retry
    let status = JobStatus.FAILED;
    if (job.retries < job.max_retries) {
      status = JobStatus.RETRYING;
      
      // Increment retry count in database FIRST
      await dbManager.incrementJobRetries(job.request_id);
    }
    
    // Update job status in database FIRST
    await dbManager.updateJobStatus(job.request_id, status, error.message);
    
    // THEN emit the status change event
    await emitJobStatusChange(job.request_id, status, { job, error: error.message });
    
    // Decrement active jobs counter
    activeJobs--;
    
    if (status === JobStatus.RETRYING) {
      console.log(`[Queue] Job ${job.id} (${job.request_id}) will be retried (${job.retries + 1}/${job.max_retries})`);
      
      // Schedule retry after delay (exponential backoff) using config
      const retryDelay = Math.pow(queueConfig.retryDelayBase, job.retries) * queueConfig.retryDelayMultiplier;
      console.log(`[Queue] Scheduling retry for job ${job.request_id} in ${retryDelay}ms`);
      
      setTimeout(() => {
        console.log(`[Queue] Executing scheduled retry for job ${job.request_id}`);
        processNextJob();
      }, retryDelay);
    } else {
      // Job has failed permanently
      await emitJobStatusChange(job.request_id, JobStatus.FAILED, { job, error: error.message });
      
      // Clean up memory for failed jobs
      processorFunctions.delete(job.request_id);
      completionCallbacks.delete(job.request_id);
      
      // Continue with next job even if current failed
      setTimeout(() => processNextJob(), 0);
    }
    
    return false;
  }
};

/**
 * Manually retry a failed or stuck job
 * @param {string} requestId - Request ID of the job to retry
 * @returns {Promise<boolean>} - True if job was reset for retry
 */
const retryJob = async (requestId) => {
  try {
    // Get the current job status
    const job = await dbManager.getJobByRequestId(requestId);
    
    if (!job) {
      console.log(`[Queue] Job ${requestId} not found for retry`);
      return false;
    }
    
    // Only allow retry for failed or stuck jobs
    if (job.status !== 'failed' && job.status !== 'processing') {
      console.log(`[Queue] Job ${requestId} cannot be retried (status: ${job.status})`);
      return false;
    }
    
    // Reset the job to pending status
    const success = await dbManager.resetJobForRetry(requestId);
    
    if (success) {
      console.log(`[Queue] Job ${requestId} reset for manual retry`);
      
      // Emit event for manual retry
      await emitJobStatusChange(requestId, JobStatus.PENDING, { 
        job, 
        manualRetry: true 
      });
      
      // Trigger immediate processing
      setTimeout(() => processNextJob(), 100);
      
      return true;
    }
    
    return false;
  } catch (error) {
    console.error(`[Queue] Error retrying job ${requestId}:`, error);
    return false;
  }
};

/**
 * Clean up stuck jobs (jobs that have been "processing" for too long)
 * @param {number} timeoutMinutes - Consider jobs stuck after this many minutes
 * @returns {Promise<number>} - Number of jobs cleaned up
 */
const cleanupStuckJobs = async (timeoutMinutes = 30) => {
  try {
    console.log(`[Queue] Checking for jobs stuck longer than ${timeoutMinutes} minutes`);
    
    // Get stuck jobs first for logging
    const stuckJobs = await dbManager.getStuckJobs(timeoutMinutes);
    
    if (stuckJobs.length > 0) {
      console.log(`[Queue] Found ${stuckJobs.length} stuck jobs`);
      
      // Mark them as failed
      const markedCount = await dbManager.markStuckJobsAsFailed(timeoutMinutes);
      
      // Emit events for each stuck job
      for (const job of stuckJobs) {
        await emitJobStatusChange(job.request_id, JobStatus.FAILED, { 
          job, 
          error: 'Job timed out and was marked as failed',
          timeout: true 
        });
        
        // Clean up memory
        processorFunctions.delete(job.request_id);
        completionCallbacks.delete(job.request_id);
      }
      
      return markedCount;
    }
    
    return 0;
  } catch (error) {
    console.error('[Queue] Error cleaning up stuck jobs:', error);
    return 0;
  }
};

/**
 * Register a processor function for a specific job
 * @param {string} requestId - Request ID of the job
 * @param {Function} processorFunction - Function to process this job
 */
const registerProcessorFunction = (requestId, processorFunction) => {
  if (typeof processorFunction === 'function') {
    processorFunctions.set(requestId, processorFunction);
    console.log(`[Queue] Registered processor function for job ${requestId}`);
  } else {
    console.warn(`[Queue] Invalid processor function provided for job ${requestId}`);
  }
};

/**
 * Start the job processor
 */
const startJobProcessor = async () => {
  console.log(`[Queue] Starting job processor with max ${queueConfig.maxConcurrentJobs} concurrent jobs`);
  
  // Initialize database tables
  await initQueueDatabase();
  
  // Clean up any stuck jobs from previous runs
  const stuckCount = await cleanupStuckJobs(30);
  if (stuckCount > 0) {
    console.log(`[Queue] Cleaned up ${stuckCount} stuck jobs from previous runs`);
  }
  
  // Start processing jobs - initialize up to maxConcurrentJobs processors
  for (let i = 0; i < queueConfig.maxConcurrentJobs; i++) {
    processNextJob();
  }
  
  // Set up periodic job processor check using interval from config
  setInterval(() => {
    // Check if we can start more jobs (if some have completed)
    const availableSlots = queueConfig.maxConcurrentJobs - activeJobs;
    
    // Try to fill all available slots
    for (let i = 0; i < availableSlots; i++) {
      processNextJob();
    }
  }, queueConfig.processorInterval);
  
  // Set up periodic cleanup of stuck jobs (every 10 minutes)
  setInterval(() => {
    cleanupStuckJobs(30);
  }, 10 * 60 * 1000); // 10 minutes
};

module.exports = {
  JobStatus,
  JobType,
  JobPriority,
  initQueueDatabase,
  enqueueJob,
  getJobByRequestId: dbManager.getJobByRequestId,
  updateJobStatus: dbManager.updateJobStatus, // Export this for use in callbacks
  processNextJob,
  startJobProcessor,
  registerProcessorFunction,
  onJobStatusChange,
  onJobComplete,
  retryJob,
  cleanupStuckJobs,
  jobEventEmitter // Export for advanced usage
};
