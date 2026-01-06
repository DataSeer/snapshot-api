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
- [ScholarOne Integration](#scholarone-integration)
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
- **ScholarOne API integration** for manuscript submissions with webhook notifications
- **Snapshot Mails integration** for email-based PDF submissions
- **Job status tracking and retry mechanism** with exponential backoff
- **Event-driven job completion callbacks** for reliable external notifications
- **Configurable graph parameters** for publication-specific GenShare processing
- Comprehensive logging system
- SQLite database for article-request mapping and job queue management
- Endpoints for report retrieval by article ID or request ID

## Prerequisites

- Node.js (>= 20.0.0)
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
  "maxConcurrentJobs": 2,           // Maximum number of jobs processed simultaneously
  "maxRetries": 3,                  // Default maximum retries for failed jobs
  "retryDelayBase": 2,              // Base for exponential backoff (seconds)
  "retryDelayMultiplier": 1000,     // Multiplier for retry delay (milliseconds)
  "processorInterval": 60000,       // Interval to check for new jobs (milliseconds)
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
      "fieldOrder": [],
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
      "fieldOrder": [],
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
  "defaultVersion": "",
  "versions": {
    "Report (v0.1)": {
      "snapshot-reports": {
        "url": "http://localhost:4000/api/reports/create-url",
        "method": "POST",
        "apiKey": "api-key-for-snapshot-reports"
      },
      "JSON": {
        "availableFields": ["key1", "key2", "key3"],
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
    "/requests/search": {
      "GET": {
        "description": "Search for reports by article_id or request_id",
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
    "/scholarone/submissions": {
      "POST": {
        "description": "Process ScholarOne manuscript submissions",
        "allowed": ["scholarone"],
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
    "url": "https://editorial-manager-service/api/{publication_code}/report-complete",
    "params": {
      "scores": "",
      "flag": true
    }
  },
  "das_triggers": [
    "data availability",
    "data and code availability statement",
    "data availability statement",
    "code availability",
    "data access",
    "data sharing",
    "availability of data and materials"
  ],
  "graph": {
    "available": ["PLOS", "TFOD", "SURR"],
    "default": "SURR",
    "custom": {
      "dataseer_test": "SURR",
      "journal_xyz": "PLOS"
    }
  },
  "report": {
    "available": ["PLOS (v0.1)", "PLOS (v0.2)", "TFOD (v0.1)", "TFOD (v0.2)", "Generic (v0.1)"],
    "default": "TFOD (v0.2)",
    "custom": {
      "dataseer_test": "TFOD (v0.2)",
      "pwattest": "PLOS (v0.2)"
    }
  }
}
```

### Response Filtering and Sorting

The API provides granular control over GenShare response data through user-specific filtering and sorting configurations. This allows different clients to receive customized response formats tailored to their needs.

#### Configuration Options

Each user in `conf/users.json` can configure their GenShare response handling through three properties:
```json
{
  "username": {
    "genshare": {
      "availableFields": [],      // Whitelist: only include these fields
      "restrictedFields": [],     // Blacklist: exclude these fields
      "fieldOrder": []            // Custom sort order for response fields
    }
  }
}
```

#### Field Filtering

Two mutually exclusive filtering modes are available:

1. **Whitelist Mode** (`availableFields`):
   - Only fields listed in `availableFields` will be included in the response
   - Use this when you want to explicitly control which fields are returned
   - Example: `["article_id__gs", "title__gs", "authors__gs"]`

2. **Blacklist Mode** (`restrictedFields`):
   - All fields except those listed in `restrictedFields` will be included
   - Use this when you want to exclude specific sensitive fields
   - Example: `["data_on_request__gs", "data_url__gs"]`

> **Note**: Field names in `availableFields` and `restrictedFields` must include the `__gs` suffix (internal field naming convention).

#### Response Sorting

The `fieldOrder` property allows you to customize the order in which fields appear in the response:
```json
{
  "genshare": {
    "fieldOrder": [
      "article_id__gs",
      "title__gs",
      "authors__gs",
      "publication_date__gs",
      "das_presence__gs"
    ]
  }
}
```

**Sorting Behavior:**
- Fields listed in `fieldOrder` appear first, in the specified order
- Fields not listed in `fieldOrder` appear after, maintaining their original order
- Sorting is applied to internal field names (with `__gs` suffix)
- Field name cleanup happens after sorting, so clients receive clean field names

#### Processing Pipeline

The response goes through the following pipeline:

1. **Filtering**: Apply whitelist or blacklist rules based on user configuration
2. **Sorting**: Reorder fields according to `fieldOrder` configuration
3. **Field Name Cleanup**: Remove internal suffixes (e.g., `__gs`) for client consumption
4. **Report Link Addition**: Append `report_link` field if applicable

#### Example Configuration
```json
{
  "client-example": {
    "token": "...",
    "genshare": {
      "authorizedVersions": ["v81.5.0"],
      "defaultVersion": "v81.5.0",
      "availableFields": [],
      "restrictedFields": [
        "data_on_request__gs",
        "das_in_si__gs",
        "data_url__gs",
        "non-functional_urls__gs"
      ],
      "fieldOrder": [
        "article_id__gs",
        "title__gs",
        "authors__gs",
        "publication_date__gs",
        "das_presence__gs",
        "data_availability__gs"
      ]
    }
  }
}
```

This configuration will:
1. Exclude the four restricted fields
2. Return remaining fields with `article_id` first, followed by `title`, `authors`, etc.
3. Any other fields not in `fieldOrder` will appear after, in their original order
4. All field names will have their `__gs` suffix removed in the final response

#### Implementation Details

- **Function**: `filterAndSortResponseForUser()` in `src/utils/genshareManager.js`
- **Helper**: `sortResponseData()` handles the sorting logic
- **Validation**: Empty or missing `fieldOrder` arrays are handled gracefully
- **Performance**: Sorting uses a Map-based approach for O(n log n) complexity

### Report Configuration

Both Editorial Manager and ScholarOne configurations support publication-specific report templates:

#### Report Configuration Properties:

- **`available`** (array): List of valid report versions that can be used
- **`default`** (string): Default report version used when no custom mapping exists for a publication code
- **`custom`** (object): Publication code-specific mappings where:
  - **Key**: Publication code from submission
  - **Value**: Report version to use for that publication

Available report versions:
- `PLOS (v0.1)` - PLOS report template version 0.1
- `PLOS (v0.2)` - PLOS report template version 0.2
- `TFOD (v0.1)` - TFOD report template version 0.1
- `TFOD (v0.2)` - TFOD report template version 0.2
- `Generic (v0.1)` - Generic report template version 0.1

### Graph Configuration

The Editorial Manager and ScholarOne configurations support publication-specific graph parameters that are sent to GenShare for processing:

#### Graph Configuration Properties:

- **`available`** (array): List of valid graph values that can be used
- **`default`** (string): Default graph value used when no custom mapping exists for a publication code
- **`custom`** (object): Publication code-specific mappings where:
  - **Key**: Publication code from Editorial Manager submission
  - **Value**: Graph value to use for that publication

#### How Graph Selection Works:

1. **Custom Mapping Check**: System first checks if the submission's `publication_code` has a custom mapping in the `graph.custom` object
2. **Default Fallback**: If no custom mapping exists (or is not avaialble), the system uses the value from `graph.default`  
3. **Validation**: The selected graph value is validated against the `graph.available` array
4. **GenShare Integration**: The graph value is included in the GenShare request options as `"graph": "<selected_value>"`

#### Example Graph Configuration:

```json
{
  "graph": {
    "available": ["PLOS", "TFOD", "SURR"],
    "default": "SURR",
    "custom": {
      "dataseer_test": "SURR",
      "plos_one": "PLOS", 
      "nature_comms": "TFOD",
      "science_journal": "PLOS"
    }
  }
}
```

With this configuration:
- Submissions from `dataseer_test` → uses `"SURR"`
- Submissions from `plos_one` → uses `"PLOS"`
- Submissions from `nature_comms` → uses `"TFOD"`
- Submissions from any other publication code → uses default `"SURR"`

#### Logging and Debugging:

The system provides comprehensive logging for graph configuration:
- Logs which graph value is selected for each publication code
- Warns about invalid configurations or missing values
- Tracks when graph values are sent to GenShare
- Handles configuration errors gracefully with fallback behavior

10. **ScholarOne Configuration:**
```json
// conf/scholarone.json
{
  "userId": "scholarone",
  "api": {
    "baseURL": "https://mc-beta-api.manuscriptcentral.com",
    "username": "API_USERNAME",
    "password": "your_password_here",
    "timeout": 30000,
    "endpoints": {
      "submissionFullMetadata": "/api/s1m/v11/submissions/full/metadata/submissionids",
      "submissionsByDateRange": "/api/s1m/v4/submissions/full/idsByDate"
    }
  },
  "sites": {
    "site_name": {
      "site_name": "site_name",
      "enabled": true,
      "polling_enabled": true,
      "polling_interval": 30,
      "polling_days_back": 7,
      "graph": {
        "available": ["PLOS", "TFOD", "SURR"],
        "default": "TFOD",
        "custom": {
          "dataseer_test": "TFOD"
        }
      },
      "report": {
        "available": ["PLOS (v0.1)", "TFOD (v0.1)", "PLOS (v0.2)", "TFOD (v0.2)", "Generic (v0.1)"],
        "default": "TFOD (v0.2)",
        "custom": {
          "dataseer_test": "TFOD (v0.2)"
        }
      }
    }
  },
  "workflow": {
    "retrieve_method": "notification",
    "process_timeout": 600000,
    "max_retries": 3
  },
  "notifications": {
    "enabled": true,
    "endpoint_on_hold": false,
    "shared_secret": "your-shared-secret-here",
    "allowed_ips": ["127.0.0.1", "::1"],
    "types": {
      "manuscript_submission": {
        "enabled": true,
        "allowRetryOnDuplicate": false,
        "events": [
          "Author_Submit_Manuscript_Firl",
          "Author_Submit_Manuscript_Orig",
          "Author_Submit_Manuscript_Invi",
          "Author_Submit_Manuscript_Revi",
          "Author_Submit_Manuscript_Resu"
        ]
      }
    }
  }
}
```

11. **Google Sheets Credentials:**
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
GET    /requests/search                  - Search for reports by article_id or request_id
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
GET    /editorial-manager/jobs/:reportId - Get job status by report ID
POST   /editorial-manager/retry/:reportId - Retry a failed job

# ScholarOne integration
POST   /scholarone/submissions           - Handle submissions from ScholarOne (asynchronous)
POST   /scholarone/cancel                - Cancel an in-progress submission
GET    /scholarone/jobs/:requestId       - Get job status by request ID
POST   /scholarone/retry/:requestId      - Retry a failed job
GET    /scholarone/notifications         - Webhook endpoint for ScholarOne notifications
GET    /scholarone/notifications/status  - Get ScholarOne notification configuration status

# Snapshot Mails integration
POST   /snapshot-mails/submissions       - Handle email-based PDF submissions (asynchronous)
GET    /snapshot-mails/jobs/:requestId   - Get job status for email submissions
POST   /snapshot-mails/retry/:requestId  - Retry a failed email submission job

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
  "maxConcurrentJobs": 2,        // Process up to 2 jobs simultaneously
  "maxRetries": 3,               // Retry failed jobs up to 3 times
  "retryDelayBase": 2,           // Exponential backoff base (2^retry_count)
  "retryDelayMultiplier": 1000,  // Multiply delay by this value (milliseconds)
  "processorInterval": 60000     // Check for new jobs every 60 seconds
}
```

### Monitoring Jobs

```bash
# Check job status
curl -G http://localhost:3000/editorial-manager/jobs/12345678901234567890123456789012 \
  -H "Authorization: Bearer <your-token>"

# Retry a failed job
curl -X POST http://localhost:3000/editorial-manager/retry/12345678901234567890123456789012 \
  -H "Authorization: Bearer <your-token>"
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
curl -G http://localhost:3000/editorial-manager/jobs/12345678901234567890123456789012 \
  -H "Authorization: Bearer <your-token>"

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
curl -X POST http://localhost:3000/editorial-manager/retry/12345678901234567890123456789012 \
  -H "Authorization: Bearer <your-token>"

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
curl -G http://localhost:3000/requests/search \
  -H "Authorization: Bearer <your-token>" \
  --data-urlencode "article_id=ARTICLE123"

# By request ID
curl -G http://localhost:3000/requests/search \
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
curl -G http://localhost:3000/editorial-manager/jobs/12345678901234567890123456789012 \
  -H "Authorization: Bearer <your-token>"

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
```

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

# Check specific ScholarOne notification in database
npm run db:check-notification

# List all ScholarOne notifications
npm run db:list-notifications

# View job queue status
npm run queue:status

# Clean up old completed jobs
npm run queue:cleanup
```

### ScholarOne Management

```bash
# Put ScholarOne notifications on hold (queue at ScholarOne)
npm run scholarone:hold:on

# Resume ScholarOne notifications processing
npm run scholarone:hold:off

# Check ScholarOne notification configuration status
npm run scholarone:hold:status
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
│   ├── em.json           # Editorial Manager config (includes graph and report settings)
│   ├── scholarone.json   # ScholarOne config (includes API, sites, notifications)
│   └── ...               # Other config files
├── log/                   # Log files
├── output/                # Generated files (DS logs, reports, etc.)
├── scripts/               # Management scripts
│   ├── maintenance/       # DB maintenance scripts
│   ├── analyze_logs.js
│   ├── manage_genshare_versions.js
│   ├── manage_permissions.js
│   ├── manage_users.js
│   ├── refresh_ds_logs.js # DS logs generation script
│   ├── sync_version.js
│   ├── test_scholarone_api.js # ScholarOne API testing script
│   └── toggle_scholarone_notifications_hold.js # ScholarOne notification hold management
├── sqlite/                # SQLite database (includes job queue and notifications)
├── src/
│   ├── controllers/       # Request handlers
│   │   ├── apiController.js
│   │   ├── authController.js
│   │   ├── datastetController.js
│   │   ├── emController.js      # Editorial Manager with queue integration
│   │   ├── genshareController.js
│   │   ├── grobidController.js
│   │   ├── healthController.js
│   │   ├── requestsController.js
│   │   ├── scholaroneController.js # ScholarOne submissions controller
│   │   ├── scholaroneNotificationsController.js # ScholarOne webhook controller
│   │   ├── snapshotMailsController.js # Snapshot mails controller
│   │   ├── snapshotReportsController.js # Snapshot reports controller
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
│   │   ├── requestsManager.js
│   │   ├── s3Storage.js
│   │   ├── scholaroneManager.js # ScholarOne submissions manager
│   │   ├── scholaroneNotificationsManager.js # ScholarOne notifications manager
│   │   ├── snapshotMailsManager.js # Snapshot mails manager
│   │   ├── snapshotReportsManager.js # Snapshot reports manager
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

### Graph Configuration Development

When working with the graph configuration feature:

- Graph values are determined at submission time based on publication code
- Custom mappings take precedence over default values
- All selected graph values are validated against the available array
- Comprehensive logging helps debug configuration issues
- The graph value is passed through the entire processing pipeline

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

### Graph Configuration Deployment

For production deployments with graph configuration:

- Ensure `conf/em.json` contains proper graph configuration
- Validate that all publication codes have appropriate mappings
- Test graph value selection with sample publication codes
- Monitor logs for graph configuration warnings or errors
- Consider creating backup configurations for critical publications

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
- **ScholarOne webhook security**: HMAC signature verification with shared secret
- **IP whitelisting**: ScholarOne webhook endpoints validate source IP addresses
- **Notification hold mechanism**: Ability to pause webhook processing during maintenance
- **Graph and report configuration validation**: Values are validated against allowed configurations

## Editorial Manager Integration

The API includes special endpoints for integration with Editorial Manager with full asynchronous processing:

1. **Authentication**: Uses a simplified OAuth 2.0 Password Grant flow
2. **Submission Processing**: Handles PDF submissions with metadata asynchronously
3. **Job Status Tracking**: Real-time status updates for submitted jobs
4. **Report Generation**: Creates and provides access to reports when processing completes
5. **Retry Mechanism**: Allows retrying failed jobs
6. **Cancellation**: Allows canceling in-progress submissions
7. **Graph Configuration**: Automatic graph parameter selection based on publication code

### Editorial Manager Workflow

1. Editorial Manager authenticates with the API to get a temporary token
2. EM submits a document with metadata for processing (gets immediate response with report_id)
3. The API automatically selects the appropriate graph value based on publication code
4. The API processes the document asynchronously in the background with the selected graph parameter
5. EM can check job status using the report_id
6. When processing completes, EM receives a notification and can retrieve the report
7. EM can retry failed jobs or cancel in-progress submissions

### Graph Configuration Benefits for Editorial Manager

- **Publication-Specific Processing**: Different journals can use different graph configurations
- **Centralized Management**: Graph configurations are managed in the API configuration
- **Automatic Selection**: No need for Editorial Manager to specify graph parameters
- **Fallback Behavior**: Default graph values ensure processing continues even with unknown publications
- **Configuration Validation**: Invalid graph values are caught and logged
- **Audit Trail**: All graph selections are logged for troubleshooting

### Asynchronous Benefits

- **Immediate Response**: Editorial Manager gets instant confirmation of submission
- **Reliable Processing**: Jobs continue even if client disconnects
- **Better Resource Management**: Configurable concurrency prevents system overload
- **Automatic Retry**: Failed jobs are retried automatically
- **Status Tracking**: Full visibility into job progress and outcomes

## ScholarOne Integration

The API includes comprehensive integration with ScholarOne (Manuscript Central) for automated manuscript processing with webhook notifications:

### Features

- **Direct Submissions**: Manual submission processing via API endpoint
- **Webhook Notifications**: Automatic processing triggered by ScholarOne events
- **Site-Specific Configuration**: Per-site settings for graph and report templates
- **Asynchronous Processing**: All submissions processed in background queue
- **Notification Hold**: Ability to pause webhook processing during maintenance
- **Job Status Tracking**: Real-time status updates and retry capabilities
- **Multi-Site Support**: Configure different settings for different ScholarOne sites

### ScholarOne Workflow

1. **ScholarOne sends webhook notification** when manuscript is submitted
2. **API validates webhook signature** using shared secret and allowed IPs
3. **API checks if endpoint is on hold** - if yes, ScholarOne queues the notification
4. **API retrieves manuscript metadata** from ScholarOne API
5. **API downloads PDF** from ScholarOne
6. **API selects graph and report** based on site configuration
7. **API processes submission** asynchronously in background queue
8. **GenShare analyzes** the manuscript with selected graph parameter
9. **Report is generated** using configured report template

### ScholarOne API Endpoints

```bash
# Submit a manuscript directly (bypassing webhook)
curl -X POST http://localhost:3000/scholarone/submissions \
  -H "Authorization: Bearer <your-token>" \
  -d "site_name=site_name" \
  -d "submission_id=S1M-2025-001"

# Response:
# {
#   "status": "Success",
#   "request_id": "12345678901234567890123456789012"
# }

# Check job status
curl -G http://localhost:3000/scholarone/jobs/12345678901234567890123456789012 \
  -H "Authorization: Bearer <your-token>"

# Retry a failed job
curl -X POST http://localhost:3000/scholarone/retry/12345678901234567890123456789012 \
  -H "Authorization: Bearer <your-token>"

# Cancel a submission
curl -X POST http://localhost:3000/scholarone/cancel \
  -H "Authorization: Bearer <your-token>" \
  -d "request_id=12345678901234567890123456789012"

# Get notification configuration status
curl -G http://localhost:3000/scholarone/notifications/status \
  -H "Authorization: Bearer <your-token>"
```

### ScholarOne Configuration

The ScholarOne integration requires configuration in `conf/scholarone.json`:

#### API Configuration
- **baseURL**: ScholarOne API base URL
- **username**: API username
- **password**: API password
- **endpoints**: API endpoint paths for submission metadata and date range queries

#### Site Configuration
Each site can have its own configuration:
- **enabled**: Enable/disable processing for this site
- **polling_enabled**: Enable periodic polling for new submissions
- **polling_interval**: Minutes between polling checks
- **polling_days_back**: How many days back to check for submissions
- **graph**: Site-specific graph configuration (same as Editorial Manager)
- **report**: Site-specific report template configuration

#### Notification Configuration
- **enabled**: Master enable/disable for webhook notifications
- **endpoint_on_hold**: Temporarily pause webhook processing (ScholarOne will queue)
- **shared_secret**: HMAC signature verification secret
- **allowed_ips**: IP whitelist for webhook requests
- **types**: Configure which notification types to process

#### Notification Types
- **manuscript_submission**: New manuscript submissions
  - Events: `Author_Submit_Manuscript_Orig`, `Author_Submit_Manuscript_Revi`, etc.
- **manuscript_status**: Status changes (withdrawals, unsubmits)
- **decision**: Editorial decisions
- **task_status**: Task completion events
- **transfer**: Journal transfer events

### ScholarOne Notification Hold Management

Use these commands to control webhook processing during maintenance:

```bash
# Put endpoint on hold (ScholarOne queues notifications)
npm run scholarone:hold:on

# Resume processing (ScholarOne delivers queued notifications)
npm run scholarone:hold:off

# Check current status
npm run scholarone:hold:status
```

When on hold:
- ScholarOne queues webhook notifications instead of delivering them
- No processing occurs
- Useful during maintenance or deployments
- When lifted, ScholarOne automatically delivers queued notifications

### Database Commands

```bash
# Check specific notification in database
npm run db:check-notification

# List all ScholarOne notifications
npm run db:list-notifications
```

### Asynchronous Benefits for ScholarOne

- **Immediate Webhook Response**: Quick acknowledgment to ScholarOne
- **Reliable Processing**: Jobs continue even if ScholarOne disconnects
- **Automatic Retry**: Failed processing jobs are retried automatically
- **Configurable Concurrency**: Prevent system overload during high submission volumes
- **Status Tracking**: Full visibility into processing progress

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

## Snapshot S3 Manager Integration

The API includes dedicated endpoints for integration with the snapshot-s3-manager admin interface, allowing remote configuration management of users and genshare versions.

### Admin API Endpoints

These endpoints are protected and require the `snapshot-s3-manager` user authentication:

```
# Users Management
GET    /snapshot-s3-manager/users                    - Get all users with their configurations
GET    /snapshot-s3-manager/users/:userId            - Get a specific user
PATCH  /snapshot-s3-manager/users/:userId/genshare   - Update user genshare settings
PATCH  /snapshot-s3-manager/users/:userId/reports    - Update user reports settings

# Genshare Versions Management
GET    /snapshot-s3-manager/genshare/versions        - Get all genshare versions
GET    /snapshot-s3-manager/genshare/versions/:alias - Get a specific genshare version
PATCH  /snapshot-s3-manager/genshare/versions/:alias - Update a genshare version
PUT    /snapshot-s3-manager/genshare/default         - Set default genshare version

# Reports Management (proxy to snapshot-reports)
GET    /snapshot-s3-manager/reports                  - Get all report URLs
GET    /snapshot-s3-manager/reports/kinds            - Get available report kinds
PATCH  /snapshot-s3-manager/reports/:reportId/kind   - Update a report's kind
```

### Configuration for snapshot-s3-manager

1. **Create the snapshot-s3-manager user** in `conf/users.json`:
```json
{
  "snapshot-s3-manager": {
    "token": "your-jwt-token",
    "rateLimit": {
      "max": 200,
      "windowMs": 900000
    },
    "genshare": {
      "authorizedVersions": [],
      "defaultVersion": ""
    },
    "reports": {
      "authorizedVersions": [],
      "defaultVersion": ""
    }
  }
}
```

2. **Add permissions** in `conf/permissions.json` for all `/snapshot-s3-manager/*` routes (this restricts access to only the snapshot-s3-manager user)

3. **Configure snapshot-s3-manager** with the token and this API's URL in its `.env` file

### Update User Genshare Settings

```bash
curl -X PATCH http://localhost:3000/snapshot-s3-manager/users/user123/genshare \
  -H "Authorization: Bearer <snapshot-s3-manager-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "defaultVersion": "latest",
    "authorizedVersions": ["latest", "v81.5.0"]
  }'
```

### Update User Reports Settings

```bash
curl -X PATCH http://localhost:3000/snapshot-s3-manager/users/user123/reports \
  -H "Authorization: Bearer <snapshot-s3-manager-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "defaultVersion": "PLOS (v0.3)",
    "authorizedVersions": ["PLOS (v0.3)", "TFOD (v0.3)"]
  }'
```

### Update Genshare Version

```bash
curl -X PATCH http://localhost:3000/snapshot-s3-manager/genshare/versions/latest \
  -H "Authorization: Bearer <snapshot-s3-manager-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "version": "v82.0.0",
    "processPdfUrl": "https://new-genshare-service/snapshot",
    "healthUrl": "https://new-genshare-service/health"
  }'
```

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

### Graph Configuration Dependencies

The graph configuration feature uses:
- **Editorial Manager configuration**: Graph settings stored in `conf/em.json`
- **Validation utilities**: Built-in array validation for allowed graph values
- **Logging system**: Comprehensive logging for graph selection and validation
- **GenShare integration**: Graph values passed to GenShare via options parameter