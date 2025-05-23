// File: src/utils/queueManager.js
const dbManager = require('./dbManager');
const config = require('../config');

// Load queue manager configuration
const queueConfig = require(config.queueManagerConfigPath);

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
 * Add a job to the processing queue
 * @param {string} requestId - Unique request ID for the job
 * @param {string} jobType - Type of job (from JobType enum)
 * @param {Object} data - Job data (will be stored as JSON)
 * @param {number} maxRetries - Maximum number of retries (default from config)
 * @param {number} priority - Job priority (default: NORMAL)
 * @param {Function} processorFunction - Function to process this job
 * @returns {Promise<Object>} - Created job record
 */
const enqueueJob = async (requestId, jobType, data, maxRetries = queueConfig.maxRetries, priority = JobPriority.NORMAL, processorFunction) => {
  try {
    // Store the job in the database using dbManager
    const job = await dbManager.addJobToQueue(requestId, jobType, data, maxRetries, priority);
    
    // If a processor function was provided, store it
    if (typeof processorFunction === 'function') {
      processorFunctions.set(requestId, processorFunction);
    }
    
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
    
    // Mark job as completed
    await dbManager.updateJobStatus(job.request_id, JobStatus.COMPLETED, null, result);
    
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
    }
    
    // Update job status
    await dbManager.updateJobStatus(job.request_id, status, error.message);
    
    // Decrement active jobs counter
    activeJobs--;
    
    if (status === JobStatus.RETRYING) {
      console.log(`[Queue] Job ${job.id} (${job.request_id}) will be retried (${job.retries + 1}/${job.max_retries})`);
      
      // Schedule retry after delay (exponential backoff) using config
      const retryDelay = Math.pow(queueConfig.retryDelayBase, job.retries) * queueConfig.retryDelayMultiplier;
      setTimeout(() => {
        processNextJob();
      }, retryDelay);
    } else {
      // Clean up the processor function from memory if job is failed and won't be retried
      processorFunctions.delete(job.request_id);
      
      // Continue with next job even if current failed
      setTimeout(() => processNextJob(), 0);
    }
    
    return false;
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
};

module.exports = {
  JobStatus,
  JobType,
  JobPriority,
  initQueueDatabase,
  enqueueJob,
  getJobByRequestId: dbManager.getJobByRequestId,
  processNextJob,
  startJobProcessor,
  registerProcessorFunction
};
