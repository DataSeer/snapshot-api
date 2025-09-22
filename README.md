# Snapshot API

A Node.js REST API for processing PDF documents through OSI (Open Science Indicators) verification system. This API integrates with GenShare (DataSeer AI), GROBID, and DataStet services to analyze scientific documents, detect data statements, and generate reports. It features JWT authentication, user-specific rate limiting, S3 storage for complete request traceability, SQLite database for request mapping, Google Sheets integration for reporting, and an asynchronous job queue system for background processing.

## Table of Contents

- [Features](#features)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
- [API Architecture](#api-architecture)
- [Queue System](#queue-system)
- [Authentication Flow](#authentication-flow)
- [Usage](#usage)
- [Scripts](#scripts)
- [Development](#development)
- [Deployment](#deployment)
- [Security](#security)
- [Editorial Manager Integration](#editorial-manager-integration)
- [Snapshot Mails Integration](#snapshot-mails-integration)
- [Dependencies](#dependencies)

## Features

- PDF document processing via GenShare integration
- **Asynchronous job queue system** for background processing with configurable concurrency
- Multiple GenShare version support with user-specific access control
- Response filtering based on user permissions
- JWT-based authentication system
  - Permanent tokens for long-term API access
  - Temporary tokens for external integrations (OAuth 2.0 Password Grant)
- Role-based access control for API endpoints
- User-specific rate limiting
- AWS S3 storage for complete request traceability
- Version-specific Google Sheets logging and reports
- **DS Logs generation from S3 data** with proper CSV formatting and special character handling
- Health monitoring for all integrated services
- Editorial Manager API integration for submissions handling
- **Snapshot Mails integration** for email-based PDF submissions
- **Job status tracking and retry mechanism** with exponential backoff
- **Event-driven job completion callbacks** for reliable external notifications
- Comprehensive logging system
- SQLite database for article-request mapping and job queue management
- Endpoints for report retrieval by article ID or request ID

## Prerequisites

- Node.js (>= 14.x)
- Docker for containerization (optional)
- AWS Account (for S3 storage)
- Google Cloud Account (for Google Sheets API)
- Access to:
  - GROBID service
  - DataStet service
  - GenShare service (multiple versions supported)

## Installation

### Using Docker

```bash
# Build image
docker build -t snapshot-api .

# Run with default configuration
docker run -d -p 3000:3000 --name snapshot-api snapshot-api

# Run with custom configuration
docker run -d -p 3000:3000 \
  -v $(pwd)/.env:/usr/src/app/.env \
  -v $(pwd)/conf:/usr/src/app/conf \
  -v $(pwd)/output:/usr/src/app/output \
  -v $(pwd)/log:/usr/src/app/log \
  -v $(pwd)/sqlite:/usr/src/app/sqlite \
  snapshot-api
```

### Direct Installation

```bash
# Clone repository
git clone https://github.com/DataSeer/snapshot-api.git
cd snapshot-api

# Install dependencies
npm install

# Copy configuration files
cp .env.default .env
mkdir -p conf sqlite log output
cp conf/*.default conf/
```

## Configuration

### Environment Variables (.env)
```env
JWT_SECRET=your_jwt_secret_key
TOKEN_EXPIRATION=3600  # Temporary token expiration in seconds (default: 1 hour)
PORT=3000
NODE_ENV=production    # 'development' or 'production'
NO_DB_REFRESH=false    # Set to 'true' to skip S3 refresh on startup
```

### Required Configuration Files

1. **Queue Manager Configuration:**
```json
// conf/queueManager.json
{
  "maxConcurrentJobs": 3,           // Maximum number of jobs processed simultaneously
  "maxRetries": 3,                  // Default maximum retries for failed jobs
  "retryDelayBase": 2,              // Base for exponential backoff (seconds)
  "retryDelayMultiplier": 1000,     // Multiplier for retry delay (milliseconds)
  "processorInterval": 5000,        // Interval to check for new jobs (milliseconds)
  "jobPriorities": {
    "LOW": 1,
    "NORMAL": 5,
    "HIGH": 10,
    "CRITICAL": 20
  }
}
```

2. **GenShare Configuration:**
```json
// conf/genshare.json
{
  "defaultVersion": "v1.0.0",
  "versions": {
    "v1.0.0": {
      "processPDF": {
        "url": "https://genshare-service/snapshot",
        "method": "POST",
        "apiKey": "your_genshare_api_key"
      },
      "health": {
        "url": "https://genshare-service/health",
        "method": "GET"
      },
      "googleSheets": {
        "spreadsheetId": "your-spreadsheet-id",
        "sheetName": "Sheet1"
      },
      "responseMapping": {
        "getPath": ["Path element", "Score", "Other fields"],
        "getResponse": {
          "article_id": 0,
          "das_presence": 1,
          "data_url": 2
        }
      }
    }
  }
}
```

3. **GROBID Configuration:**
```json
// conf/grobid.json
{
  "health": {
    "url": "https://grobid-service/health",
    "method": "GET"
  }
}
```

4. **DataStet Configuration:**
```json
// conf/datastet.json
{
  "health": {
    "url": "https://datastet-service/health",
    "method": "GET"
  }
}
```

5. **Users Configuration:**
```json
// conf/users.json
{
  "admin": {
    "token": "jwt_token_here",
    "client_secret": "client_secret_for_temp_tokens",
    "rateLimit": {
      "max": 200,
      "windowMs": 900000
    },
    "genshare": {
      "authorizedVersions": ["v1.0.0", "v2.0.0"],
      "defaultVersion": "v1.0.0",
      "availableFields": [],
      "restrictedFields": []
    },
    "reports": {
      "authorizedVersions": ["Report v1"],
      "defaultVersion": "Report v1"
    }
  },
  "snapshot-mails": {
    "token": "jwt_token_for_snapshot_mails",
    "client_secret": "client_secret_for_snapshot_mails",
    "rateLimit": {
      "max": 100,
      "windowMs": 900000
    },
    "genshare": {
      "authorizedVersions": ["v1.0.0"],
      "defaultVersion": "v1.0.0",
      "availableFields": [],
      "restrictedFields": []
    },
    "reports": {
      "authorizedVersions": ["Report v1"],
      "defaultVersion": "Report v1"
    }
  }
}
```

6. **Reports Configuration:**
```json
// conf/reports.json
{
  "defaultVersion": "Report v1",
  "versions": {
    "Report v1": {
      "googleSheets": {
        "folder": {
          "default": "google_drive_folder_id"
        },
        "template": {
          "default": "spreadsheet_template_id"
        },
        "permissions": {
          "default": "reader"
        },
        "sheets": {
          "Sheet1": {
            "cells": {
              "A1": "article_id",
              "B1": "das_presence"
            }
          }
        }
      },
      "JSON": {
        "availableFields": [],
        "restrictedFields": []
      }
    }
  }
}
```

7. **Permissions Configuration:**
```json
// conf/permissions.json
{
  "routes": {
    "/": {
      "GET": {
        "description": "Get all available API routes",
        "allowed": [],
        "blocked": []
      }
    },
    "/processPDF": {
      "POST": {
        "description": "Process a PDF file",
        "allowed": ["admin", "user1"],
        "blocked": []
      }
    },
    "/reports/search": {
      "GET": {
        "description": "Search for reports",
        "allowed": ["admin"],
        "blocked": []
      }
    },
    "/snapshot-mails/submissions": {
      "POST": {
        "description": "Process email-based PDF submissions",
        "allowed": ["snapshot-mails"],
        "blocked": []
      }
    },
    "/snapshot-mails/jobs": {
      "GET": {
        "description": "Check job status for email submissions",
        "allowed": ["snapshot-mails"],
        "blocked": []
      }
    },
    "/snapshot-mails/test-notification": {
      "POST": {
        "description": "Test notification system",
        "allowed": ["snapshot-mails"],
        "blocked": []
      }
    }
  }
}
```

8. **AWS S3 Configuration:**
```json
// conf/aws.s3.json
{
  "accessKeyId": "YOUR_AWS_ACCESS_KEY",
  "secretAccessKey": "YOUR_AWS_SECRET_KEY",
  "region": "us-east-1",
  "bucketName": "your-bucket-name",
  "s3Folder": "folder-prefix"
}
```

9. **Editorial Manager Configuration:**
```json
// conf/em.json
{
  "reportCompleteNotification": {
    "disabled": false,
    "url": "https://editorial-manager-service/api/{publication_code}/report-complete"
  },
  "das_triggers": ["data availability", "data sharing", "data access"]
}
```

10. **Google Sheets Credentials:**
```json
// conf/googleSheets.credentials.json
{
  "type": "service_account",
  "project_id": "your-project-id",
  "private_key_id": "your-private-key-id",
  "private_key": "your-private-key",
  "client_email": "your-service-account-email",
  "client_id": "your-client-id",
  "auth_uri": "https://accounts.google.com/o/oauth2/auth",
  "token_uri": "https://oauth2.googleapis.com/token",
  "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
  "client_x509_cert_url": "your-client-cert-url"
}
```

## API Architecture

### Available Endpoints

```
# Authentication
POST   /editorial-manager/authenticate   - Get temporary token using client credentials
POST   /editorial-manager/revokeToken    - Revoke a temporary token

# API information
GET    /                                 - List available API routes
GET    /versions                         - Get version information
GET    /ping                             - Health check all services

# Core functionality
POST   /processPDF                       - Process a PDF file (asynchronous)
GET    /reports/search                   - Search for reports by article_id or request_id
POST   /requests/refresh                 - Refresh article-request ID mapping from S3

# Service health checks
GET    /genshare/health                  - Check GenShare service health
GET    /grobid/health                    - Check GROBID service health
GET    /datastet/health                  - Check DataStet service health

# Editorial Manager integration
POST   /editorial-manager/submissions    - Handle submissions from Editorial Manager (asynchronous)
POST   /editorial-manager/cancel         - Cancel an in-progress submission
POST   /editorial-manager/reports        - Get report data
POST   /editorial-manager/reportLink     - Get report URL from token
GET    /editorial-manager/job-status     - Get job status by report ID
POST   /editorial-manager/retry          - Retry a failed job

# Snapshot Mails integration
POST   /snapshot-mails/submissions       - Handle email-based PDF submissions (asynchronous)
GET    /snapshot-mails/jobs/:requestId   - Get job status for email submissions
POST   /snapshot-mails/test-notification - Test notification system

# Snapshot Reports endpoints
GET    /snapshot-reports/:requestId/genshare - Get GenShare data for a request
```

## Queue System

The API includes a robust asynchronous job queue system for background processing:

### Key Features

- **Asynchronous Processing**: All PDF processing jobs run in the background, allowing immediate API responses
- **Configurable Concurrency**: Control how many jobs process simultaneously via `maxConcurrentJobs`
- **Automatic Retry Logic**: Failed jobs are automatically retried with exponential backoff
- **Job Prioritization**: Support for LOW, NORMAL, HIGH, and CRITICAL priority levels
- **Event-Driven Callbacks**: Execute functions when jobs complete or fail
- **Database Persistence**: All jobs are stored in SQLite with full status tracking
- **Race Condition Prevention**: Database updates occur before callback execution

### Job Lifecycle

1. **Submission**: Job is added to the queue and assigned a unique request ID
2. **Pending**: Job waits in queue until a processing slot is available
3. **Processing**: Job is actively being processed by a worker
4. **Completed/Failed**: Job finishes successfully or fails after max retries
5. **Cleanup**: Memory is cleaned up and callbacks are executed

### Job Status Values

- `pending`: Job is queued waiting for processing
- `processing`: Job is currently being processed
- `completed`: Job finished successfully
- `failed`: Job failed permanently after all retries
- `retrying`: Job failed but will be retried

### Configuration Options

```json
{
  "maxConcurrentJobs": 3,        // Process up to 3 jobs simultaneously
  "maxRetries": 3,               // Retry failed jobs up to 3 times
  "retryDelayBase": 2,           // Exponential backoff base (2^retry_count)
  "retryDelayMultiplier": 1000,  // Multiply delay by this value (milliseconds)
  "processorInterval": 5000      // Check for new jobs every 5 seconds
}
```

### Monitoring Jobs

```bash
# Check job status
curl -G http://localhost:3000/editorial-manager/job-status \
  -H "Authorization: Bearer <your-token>" \
  --data-urlencode "report_id=12345678901234567890123456789012"

# Retry a failed job
curl -X POST http://localhost:3000/editorial-manager/retry \
  -H "Authorization: Bearer <your-token>" \
  -d "report_id=12345678901234567890123456789012"
```

## Authentication Flow

### Permanent Token Authentication (for direct API users)

1. Token Generation:
```bash
npm run manage-users -- add user123
# Output will include a token that can be used for authentication
```

2. Request Authentication:
```bash
curl -H "Authorization: Bearer <access_token>" http://localhost:3000/endpoint
```

### Temporary Token Authentication (for Editorial Manager)

1. Obtain a temporary token:
```bash
curl -X POST http://localhost:3000/editorial-manager/authenticate \
  -d "client_id=client_id_here" \
  -d "client_secret=client_secret_here" \
  -d "grant_type=password"

# Response:
# {
#   "access_token": "eyJhbGciOiJ...",
#   "token_type": "bearer",
#   "expires_in": 3600
# }
```

2. Use the temporary token:
```bash
curl -H "Authorization: Bearer <access_token>" http://localhost:3000/endpoint
```

3. Revoke a temporary token:
```bash
curl -X POST http://localhost:3000/editorial-manager/revokeToken \
  -d "token=<access_token>"

# Response:
# {
#   "message": "Token revoked successfully"
# }
```

## Usage

### Processing PDFs (Asynchronous)

All PDF processing is now asynchronous and returns immediately with a request ID:

```bash
# Basic usage with PDF only - returns immediately with request_id
curl -X POST http://localhost:3000/processPDF \
  -H "Authorization: Bearer <your-token>" \
  -F "file=@document.pdf" \
  -F 'options={"article_id": "ARTICLE123"}'

# With supplementary files (ZIP format required)
curl -X POST http://localhost:3000/processPDF \
  -H "Authorization: Bearer <your-token>" \
  -F "file=@document.pdf" \
  -F "supplementary_file=@supplementary.zip" \
  -F 'options={"article_id": "ARTICLE123", "document_type": "article"}'

# Response:
# {
#   "status": "Success",
#   "request_id": "12345678901234567890123456789012",
#   "message": "PDF processing started in background"
# }
```

#### Supplementary Files Support

The API now supports optional supplementary files that can be included with PDF submissions:

- **Format**: Must be a ZIP file (`.zip` extension or `application/zip` MIME type)
- **Field Name**: Use `supplementary_file` as the form field name
- **Processing**: The ZIP file is forwarded to GenShare for analysis alongside the main PDF
- **Storage**: Both PDF and supplementary files are stored in AWS S3 for complete traceability
- **Validation**: Non-ZIP files are rejected with a 400 error

Example file structure for supplementary materials:
```
supplementary.zip
├── data/
│   ├── dataset1.csv
│   └── dataset2.xlsx
├── figures/
│   ├── figure_s1.png
│   └── figure_s2.tiff
└── code/
    ├── analysis.py
    └── requirements.txt
```

### Checking Job Status

```bash
# Check processing status
curl -G http://localhost:3000/editorial-manager/job-status \
  -H "Authorization: Bearer <your-token>" \
  --data-urlencode "report_id=12345678901234567890123456789012"

# Response examples:
# {
#   "report_id": "12345678901234567890123456789012",
#   "status": "processing",
#   "created_at": "2025-01-01T10:00:00Z",
#   "updated_at": "2025-01-01T10:01:00Z",
#   "retries": 0,
#   "max_retries": 3
# }
#
# {
#   "report_id": "12345678901234567890123456789012",
#   "status": "completed",
#   "created_at": "2025-01-01T10:00:00Z",
#   "updated_at": "2025-01-01T10:05:00Z",
#   "retries": 0,
#   "max_retries": 3,
#   "results": {
#     "genshare_status": "success",
#     "notification_status": "success"
#   }
# }
```

### Retrying Failed Jobs

```bash
# Retry a failed job
curl -X POST http://localhost:3000/editorial-manager/retry \
  -H "Authorization: Bearer <your-token>" \
  -d "report_id=12345678901234567890123456789012"

# Response:
# {
#   "status": "Success",
#   "message": "Job 12345678901234567890123456789012 has been queued for retry",
#   "report_id": "12345678901234567890123456789012"
# }
```

### Searching for Reports

```bash
# By article ID
curl -G http://localhost:3000/reports/search \
  -H "Authorization: Bearer <your-token>" \
  --data-urlencode "article_id=ARTICLE123"

# By request ID
curl -G http://localhost:3000/reports/search \
  -H "Authorization: Bearer <your-token>" \
  --data-urlencode "request_id=12345678901234567890123456789012"
```

### Editorial Manager Integration

```bash
# Submit a document (asynchronous - returns immediately)
curl -X POST http://localhost:3000/editorial-manager/submissions \
  -H "Authorization: Bearer <your-token>" \
  -F "service_id=service123" \
  -F "publication_code=journal123" \
  -F "document_id=doc123" \
  -F "article_title=Sample Article" \
  -F "article_type=Original Article" \
  -F "file=@document.pdf"

# Response:
# {
#   "status": "Success",
#   "report_id": "12345678901234567890123456789012"
# }

# Check job status
curl -G http://localhost:3000/editorial-manager/job-status \
  -H "Authorization: Bearer <your-token>" \
  --data-urlencode "report_id=12345678901234567890123456789012"

# Get a report (only available when job is completed)
curl -X POST http://localhost:3000/editorial-manager/reports \
  -H "Authorization: Bearer <your-token>" \
  -d "report_id=12345678901234567890123456789012"

# Get report URL
curl -X POST http://localhost:3000/editorial-manager/reportLink \
  -H "Authorization: Bearer <your-token>" \
  -d "report_id=12345678901234567890123456789012" \
  -d "report_token=token-12345678"

# Cancel a submission
curl -X POST http://localhost:3000/editorial-manager/cancel \
  -H "Authorization: Bearer <your-token>" \
  -d "report_id=12345678901234567890123456789012"
```

## Snapshot Mails Integration

The API includes special endpoints for integration with the snapshot-mails service for email-based PDF submissions:

### Email-Based Submission Workflow

1. **User sends email** with PDF attachment and keywords to designated email address
2. **Snapshot-mails service** processes the email and extracts PDF + keywords
3. **Snapshot-mails authenticates** with the API using client credentials
4. **Snapshot-mails submits** the PDF to the API for processing (gets immediate response with request_id)
5. **The API processes** the PDF asynchronously in the background
6. **API sends notification** to snapshot-mails when processing completes
7. **Snapshot-mails sends** results email back to original sender

### Snapshot Mails API Endpoints

```bash
# Submit PDF from email (called by snapshot-mails service)
curl -X POST http://localhost:3000/snapshot-mails/submissions \
  -H "Authorization: Bearer <snapshot-mails-token>" \
  -F "file=@document.pdf" \
  -F 'submission_data={"sender_email": "user@example.com", "keywords": {"article_type": "research"}, "filename": "paper.pdf"}'

# Response:
# {
#   "status": "Success",
#   "request_id": "12345678901234567890123456789012"
# }

# Check job status for email submission
curl -G http://localhost:3000/snapshot-mails/jobs/12345678901234567890123456789012 \
  -H "Authorization: Bearer <snapshot-mails-token>"

# Response:
# {
#   "request_id": "12345678901234567890123456789012",
#   "status": "completed",
#   "created_at": "2025-01-01T10:00:00Z",
#   "updated_at": "2025-01-01T10:05:00Z",
#   "retries": 0,
#   "max_retries": 3,
#   "results": {
#     "genshare_status": "success"
#   }
# }

### Snapshot Mails Configuration

To set up snapshot-mails integration:

1. **Create snapshot-mails user** in the API:
```bash
npm run manage-users -- add snapshot-mails
```

2. **Configure permissions** for snapshot-mails routes in `conf/permissions.json`

3. **Set up notification URL** in the snapshot-mails service configuration

4. **Deploy snapshot-mails service** with proper IMAP/SMTP credentials

### Asynchronous Benefits for Email Processing

- **Immediate Email Response**: Users get quick confirmation that their email was processed
- **Reliable Processing**: PDF processing continues even if email service disconnects
- **Better Resource Management**: Configurable concurrency prevents system overload
- **Automatic Retry**: Failed processing jobs are retried automatically
- **Status Tracking**: Full visibility into processing progress via notifications
- **Error Handling**: Users receive clear error messages via email

## Scripts

The following management scripts are available to help manage various aspects of the application:

### User Management

```bash
# Add a new user (including snapshot-mails)
npm run manage-users -- add snapshot-mails

# List all users
npm run manage-users -- list

# Refresh a user's token
npm run manage-users -- refresh-token snapshot-mails

# Refresh a client secret
npm run manage-users -- refresh-client-secret snapshot-mails

# Update rate limit
npm run manage-users -- update-limit snapshot-mails '{"max": 100, "windowMs": 900000}'

# Update GenShare settings
npm run manage-users -- update-genshare snapshot-mails '{"authorizedVersions": ["v1.0.0"], "defaultVersion": "v1.0.0"}'

# Remove a user
npm run manage-users -- remove snapshot-mails
```

### GenShare Version Management

```bash
# List all GenShare versions
npm run manage-genshare -- list

# Add a new GenShare version
npm run manage-genshare -- add v2.0.0 "https://genshare-service/snapshot" "https://genshare-service/health" "spreadsheet-id" "Sheet1" "api-key"

# Update a GenShare version
npm run manage-genshare -- update v2.0.0 --processPdfUrl "https://new-genshare-service/snapshot"

# Set default GenShare version
npm run manage-genshare -- set-default v2.0.0

# Update response mapping
npm run manage-genshare -- update-mapping v2.0.0 getResponse '{"field_name": 3}'

# Remove a GenShare version
npm run manage-genshare -- remove v2.0.0
```

### Permissions Management

```bash
# List all permissions
npm run manage-permissions -- list

# Add route permission (including snapshot-mails routes)
npm run manage-permissions -- add /snapshot-mails/submissions POST '["snapshot-mails"]' '[]'

# Allow user access to route
npm run manage-permissions -- allow /snapshot-mails/submissions POST snapshot-mails

# Block user from route
npm run manage-permissions -- block /endpoint METHOD user5

# Remove route
npm run manage-permissions -- remove /endpoint METHOD
```

### Database Management

```bash
# Initialize database (includes job queue tables)
npm run db:init

# Refresh requests from S3
npm run db:refresh

# Check article requests
npm run db:check user123 ARTICLE123

# View job queue status
npm run queue:status

# Clean up old completed jobs
npm run queue:cleanup
```

### DS Logs Generation

**NEW:** Generate Google Sheets compatible CSV logs from S3 data:

```bash
# Generate DS logs from S3 data
npm run refresh-ds-logs

# This will create files in the output/ directory:
# - ds_logs_TIMESTAMP.csv         (Main CSV file with all log data)
# - ds_logs_summary_TIMESTAMP.json (Processing summary and metadata)
```

The DS logs script:
- **Scans all S3 GenShare data** and extracts request/response information
- **Retrieves report links from SQLite database** using the report_data.report_link field
- **Handles special characters** (commas, quotes, newlines, semicolons) using Papa Parse
- **Generates CSV files** ready for Google Sheets import
- **Detects processing errors** and marks them appropriately
- **Uses existing configuration** for version mappings and response formatting
- **Creates comprehensive summaries** with processing statistics including report link counts

Output includes:
- Query ID (hyperlinked to S3 location)
- Snapshot API and GenShare versions
- Error status detection
- User information and file details
- Report URLs retrieved from database report_data
- All GenShare response fields based on version configuration
- Proper CSV formatting with special character handling

### Log Analysis

```bash
# Analyze logs
npm run analyze-logs

# Analyze specific log file
npm run analyze-logs -- path/to/logfile.log

# Analyze queue performance
npm run analyze-queue-logs
```

## Development

### Project Structure

```
snapshot-api/
├── conf/                  # Configuration files
│   ├── queueManager.json  # Queue system configuration
│   └── ...               # Other config files
├── log/                   # Log files
├── output/                # Generated files (DS logs, reports, etc.)
├── scripts/               # Management scripts
│   ├── maintenance/       # DB maintenance scripts
│   ├── analyze_logs.js
│   ├── manage_genshare_versions.js
│   ├── manage_permissions.js
│   ├── manage_users.js
│   ├── queue_status.js    # Queue monitoring script
│   ├── refresh_ds_logs.js # NEW: DS logs generation script
│   ├── sync_version.js
│   └── test_csv_handling.js # NEW: CSV handling test script
├── sqlite/                # SQLite database (includes job queue)
├── src/
│   ├── controllers/       # Request handlers
│   │   ├── apiController.js
│   │   ├── authController.js
│   │   ├── datastetController.js
│   │   ├── emController.js      # Updated with queue integration
│   │   ├── genshareController.js
│   │   ├── grobidController.js
│   │   ├── healthController.js
│   │   ├── reportsController.js
│   │   ├── requestsController.js
│   │   ├── snapshotMailsController.js # Snapshot mails controller
│   │   └── versionsController.js
│   ├── middleware/        # Express middleware
│   │   ├── auth.js
│   │   └── permissions.js
│   ├── routes/            # API routes
│   │   └── index.js
│   ├── utils/             # Utility functions
│   │   ├── dbManager.js
│   │   ├── emManager.js
│   │   ├── genshareManager.js # Updated exports for DS logs
│   │   ├── googleSheets.js # Updated with CSV utilities
│   │   ├── jwtManager.js
│   │   ├── logger.js
│   │   ├── permissionsManager.js
│   │   ├── queueManager.js      # Job queue system
│   │   ├── rateLimiter.js
│   │   ├── reportsManager.js
│   │   ├── requestsManager.js
│   │   ├── s3Storage.js
│   │   ├── snapshotMailsManager.js # Snapshot mails manager
│   │   ├── userManager.js
│   │   └── versions.js
│   ├── config.js          # Application configuration
│   └── server.js          # Application entry point (starts queue processor)
└── tmp/                   # Temporary file uploads
```

### Starting the Server

```bash
# Start the server (includes job queue processor)
npm start

# Start in development mode (no database refresh on startup)
npm run start:dev
```

### Queue System Development

The queue system runs automatically when the server starts. Key development considerations:

- Jobs are processed in the background with configurable concurrency
- All job state is persisted in SQLite for reliability
- Event callbacks ensure external notifications happen after database updates
- Failed jobs are automatically retried with exponential backoff
- Memory cleanup prevents resource leaks

## Deployment

### Docker Deployment

```bash
# Build the Docker image
docker build -t snapshot-api:latest .

# Run the container
docker run -d \
  -p 3000:3000 \
  -v $(pwd)/conf:/usr/src/app/conf \
  -v $(pwd)/sqlite:/usr/src/app/sqlite \
  -v $(pwd)/log:/usr/src/app/log \
  -v $(pwd)/output:/usr/src/app/output \
  --name snapshot-api \
  snapshot-api:latest
```

### Environment Variables for Production

For production deployments, make sure to set the following environment variables:

```
NODE_ENV=production
JWT_SECRET=<strong-secret-key>
PORT=3000
```

### Queue System Considerations

- Monitor the `maxConcurrentJobs` setting based on available resources
- Adjust retry settings based on external service reliability
- Consider job cleanup policies for long-running deployments
- Monitor queue performance through logs and status endpoints

## Security

- JWT-based authentication with permanent and temporary tokens
- Route-specific access control through permissions system
- User-specific rate limiting to prevent abuse
- Response filtering based on user permissions
- Secure token storage and management
- Complete request traceability via S3 storage
- Temporary token revocation capability
- Token expiration for temporary tokens
- **Job isolation**: Each job runs independently with proper error handling
- **Database transaction safety**: Queue operations use proper database transactions
- **Email authorization**: Only authorized email addresses can submit via snapshot-mails

## Editorial Manager Integration

The API includes special endpoints for integration with Editorial Manager with full asynchronous processing:

1. **Authentication**: Uses a simplified OAuth 2.0 Password Grant flow
2. **Submission Processing**: Handles PDF submissions with metadata asynchronously
3. **Job Status Tracking**: Real-time status updates for submitted jobs
4. **Report Generation**: Creates and provides access to reports when processing completes
5. **Retry Mechanism**: Allows retrying failed jobs
6. **Cancellation**: Allows canceling in-progress submissions

### Editorial Manager Workflow

1. Editorial Manager authenticates with the API to get a temporary token
2. EM submits a document with metadata for processing (gets immediate response with report_id)
3. The API processes the document asynchronously in the background
4. EM can check job status using the report_id
5. When processing completes, EM receives a notification and can retrieve the report
6. EM can retry failed jobs or cancel in-progress submissions

### Asynchronous Benefits

- **Immediate Response**: Editorial Manager gets instant confirmation of submission
- **Reliable Processing**: Jobs continue even if client disconnects
- **Better Resource Management**: Configurable concurrency prevents system overload
- **Automatic Retry**: Failed jobs are retried automatically
- **Status Tracking**: Full visibility into job progress and outcomes

## Snapshot Mails Integration

The API includes special endpoints for integration with the snapshot-mails service for email-based PDF submissions with full asynchronous processing:

### Features

- **Email-Based Submissions**: Users can submit PDFs via email with keywords
- **Asynchronous Processing**: All email submissions are processed in the background
- **Notification System**: Automatic notifications sent back to snapshot-mails service
- **Job Status Tracking**: Real-time status updates for email-based submissions
- **Error Handling**: Comprehensive error handling with email notifications to users

### Snapshot Mails Workflow

1. **User sends email** with PDF attachment and keywords to designated email address
2. **Snapshot-mails service** monitors the email address and processes new emails
3. **Snapshot-mails authenticates** with the API using client credentials (OAuth 2.0)
4. **Snapshot-mails submits** PDF and metadata to API (gets immediate response with request_id)
5. **The API processes** the PDF asynchronously in the background
6. **API sends notification** to snapshot-mails when processing completes or fails
7. **Snapshot-mails retrieves** final results and sends email response to original sender

### Configuration for Snapshot Mails

1. **Create snapshot-mails user** with appropriate permissions
2. **Configure notification URL** in snapshot-mails service
3. **Set up email monitoring** in snapshot-mails service
4. **Configure SMTP settings** for result email delivery

## Dependencies

### Main Dependencies

- **express**: Web framework for API endpoints
- **jsonwebtoken**: JWT token generation and verification
- **sqlite3**: Database for article-request mapping, job queue, and token storage
- **aws-sdk**: AWS S3 integration for file storage
- **googleapis**: Google Sheets integration for reporting
- **axios**: HTTP client for service calls
- **multer**: File upload middleware for multipart/form-data parsing
- **winston** and **morgan**: Logging utilities
- **express-rate-limit**: Rate limiting middleware
- **events**: Node.js EventEmitter for job status callbacks
- **papaparse**: Robust CSV parsing and generation with special character handling

### Development Dependencies

- **eslint**: Code linting

### Queue System Dependencies

The queue system is built using native Node.js capabilities:
- **SQLite3**: Job persistence and state management
- **EventEmitter**: Job status change notifications
- **setTimeout**: Retry scheduling with exponential backoff
- **Promise**: Asynchronous job processing coordination

### DS Logs Dependencies

The DS logs generation system uses:
- **Papa Parse**: Professional CSV handling with proper escaping
- **S3 Storage utilities**: Existing S3 integration for data retrieval
- **GenShare Manager**: Existing data formatting functions
- **Google Sheets utilities**: Date/time formatting helpers

### Snapshot Mails Dependencies

The snapshot-mails integration uses:
- **axios**: HTTP client for notification callbacks
- **Database utilities**: Mail submission tracking and management
- **Queue system**: Asynchronous job processing for email submissions