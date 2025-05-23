# Snapshot API

A Node.js REST API for processing PDF documents through OSI (Open Science Indicators) verification system. This API integrates with GenShare (DataSeer AI), GROBID, and DataStet services to analyze scientific documents, detect data statements, and generate reports. It features JWT authentication, user-specific rate limiting, S3 storage for complete request traceability, SQLite database for request mapping, and Google Sheets integration for reporting.

## Table of Contents

- [Features](#features)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
- [API Architecture](#api-architecture)
- [Authentication Flow](#authentication-flow)
- [Usage](#usage)
- [Scripts](#scripts)
- [Development](#development)
- [Deployment](#deployment)
- [Security](#security)
- [Editorial Manager Integration](#editorial-manager-integration)
- [Dependencies](#dependencies)

## Features

- PDF document processing via GenShare integration
- Multiple GenShare version support with user-specific access control
- Response filtering based on user permissions
- JWT-based authentication system
  - Permanent tokens for long-term API access
  - Temporary tokens for external integrations (OAuth 2.0 Password Grant)
- Role-based access control for API endpoints
- User-specific rate limiting
- AWS S3 storage for complete request traceability
- Version-specific Google Sheets logging and reports
- Health monitoring for all integrated services
- Editorial Manager API integration for submissions handling
- Comprehensive logging system
- SQLite database for article-request mapping
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
mkdir -p conf sqlite log
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

1. **GenShare Configuration:**
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

2. **GROBID Configuration:**
```json
// conf/grobid.json
{
  "health": {
    "url": "https://grobid-service/health",
    "method": "GET"
  }
}
```

3. **DataStet Configuration:**
```json
// conf/datastet.json
{
  "health": {
    "url": "https://datastet-service/health",
    "method": "GET"
  }
}
```

4. **Users Configuration:**
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
  }
}
```

5. **Reports Configuration:**
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

6. **Permissions Configuration:**
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
    }
  }
}
```

7. **AWS S3 Configuration:**
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

8. **Editorial Manager Configuration:**
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

9. **Google Sheets Credentials:**
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
POST   /processPDF                       - Process a PDF file
GET    /reports/search                   - Search for reports by article_id or request_id
POST   /requests/refresh                 - Refresh article-request ID mapping from S3

# Service health checks
GET    /genshare/health                  - Check GenShare service health
GET    /grobid/health                    - Check GROBID service health
GET    /datastet/health                  - Check DataStet service health

# Editorial Manager integration
POST   /editorial-manager/submissions    - Handle submissions from Editorial Manager
POST   /editorial-manager/cancel         - Cancel an in-progress submission
POST   /editorial-manager/reports        - Get report data
POST   /editorial-manager/reportLink     - Get report URL from token
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

### Processing PDFs

```bash
# Basic usage
curl -X POST http://localhost:3000/processPDF \
  -H "Authorization: Bearer <your-token>" \
  -F "file=@document.pdf" \
  -F 'options={"article_id": "ARTICLE123"}'

# With specific GenShare version
curl -X POST http://localhost:3000/processPDF \
  -H "Authorization: Bearer <your-token>" \
  -F "file=@document.pdf" \
  -F 'options={"article_id": "ARTICLE123"}' \
  -F 'genshareVersion=v2.0.0'

# With specific report version
curl -X POST http://localhost:3000/processPDF \
  -H "Authorization: Bearer <your-token>" \
  -F "file=@document.pdf" \
  -F 'options={"article_id": "ARTICLE123"}' \
  -F 'report=Report v1'
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
# Submit a document
curl -X POST http://localhost:3000/editorial-manager/submissions \
  -H "Authorization: Bearer <your-token>" \
  -F "service_id=service123" \
  -F "publication_code=journal123" \
  -F "document_id=doc123" \
  -F "article_title=Sample Article" \
  -F "article_type=Original Article" \
  -F "file=@document.pdf"

# Get a report
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

## Scripts

The following management scripts are available to help manage various aspects of the application:

### User Management

```bash
# Add a new user
npm run manage-users -- add user123

# List all users
npm run manage-users -- list

# Refresh a user's token
npm run manage-users -- refresh-token user123

# Refresh a client secret
npm run manage-users -- refresh-client-secret user123

# Update rate limit
npm run manage-users -- update-limit user123 '{"max": 200, "windowMs": 900000}'

# Update GenShare settings
npm run manage-users -- update-genshare user123 '{"authorizedVersions": ["v1.0.0", "v2.0.0"], "defaultVersion": "v2.0.0"}'

# Remove a user
npm run manage-users -- remove user123
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

# Add route permission
npm run manage-permissions -- add /endpoint METHOD '["user1", "user2"]' '["user3"]'

# Allow user access to route
npm run manage-permissions -- allow /endpoint METHOD user4

# Block user from route
npm run manage-permissions -- block /endpoint METHOD user5

# Remove route
npm run manage-permissions -- remove /endpoint METHOD
```

### Database Management

```bash
# Initialize database
npm run db:init

# Refresh requests from S3
npm run db:refresh

# Check article requests
npm run db:check user123 ARTICLE123
```

### Log Analysis

```bash
# Analyze logs
npm run analyze-logs

# Analyze specific log file
npm run analyze-logs -- path/to/logfile.log
```

## Development

### Project Structure

```
snapshot-api/
├── conf/                  # Configuration files
├── log/                   # Log files
├── scripts/               # Management scripts
│   ├── maintenance/       # DB maintenance scripts
│   ├── analyze_logs.js
│   ├── manage_genshare_versions.js
│   ├── manage_permissions.js
│   ├── manage_users.js
│   └── sync_version.js
├── sqlite/                # SQLite database
├── src/
│   ├── controllers/       # Request handlers
│   │   ├── apiController.js
│   │   ├── authController.js
│   │   ├── datastetController.js
│   │   ├── emController.js
│   │   ├── genshareController.js
│   │   ├── grobidController.js
│   │   ├── healthController.js
│   │   ├── reportsController.js
│   │   ├── requestsController.js
│   │   └── versionsController.js
│   ├── middleware/        # Express middleware
│   │   ├── auth.js
│   │   └── permissions.js
│   ├── routes/            # API routes
│   │   └── index.js
│   ├── utils/             # Utility functions
│   │   ├── dbManager.js
│   │   ├── emManager.js
│   │   ├── genshareManager.js
│   │   ├── googleSheets.js
│   │   ├── jwtManager.js
│   │   ├── logger.js
│   │   ├── permissionsManager.js
│   │   ├── rateLimiter.js
│   │   ├── reportsManager.js
│   │   ├── requestsManager.js
│   │   ├── s3Storage.js
│   │   ├── userManager.js
│   │   └── versions.js
│   ├── config.js          # Application configuration
│   └── server.js          # Application entry point
└── tmp/                   # Temporary file uploads
```

### Starting the Server

```bash
# Start the server
npm start

# Start in development mode (no database refresh on startup)
npm run start:dev
```

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

## Security

- JWT-based authentication with permanent and temporary tokens
- Route-specific access control through permissions system
- User-specific rate limiting to prevent abuse
- Response filtering based on user permissions
- Secure token storage and management
- Complete request traceability via S3 storage
- Temporary token revocation capability
- Token expiration for temporary tokens

## Editorial Manager Integration

The API includes special endpoints for integration with Editorial Manager:

1. **Authentication**: Uses a simplified OAuth 2.0 Password Grant flow
2. **Submission Processing**: Handles PDF submissions with metadata
3. **Report Generation**: Creates and provides access to reports
4. **Cancellation**: Allows canceling in-progress submissions

### Editorial Manager Workflow

1. Editorial Manager authenticates with the API to get a temporary token
2. EM submits a document with metadata for processing
3. The API processes the document and generates a report
4. EM can retrieve the report data or URL when needed
5. EM can cancel processing if necessary

## Dependencies

### Main Dependencies

- **express**: Web framework for API endpoints
- **jsonwebtoken**: JWT token generation and verification
- **sqlite3**: Database for article-request mapping and token storage
- **aws-sdk**: AWS S3 integration for file storage
- **googleapis**: Google Sheets integration for reporting
- **axios**: HTTP client for service calls
- **multer**: File upload middleware for multipart/form-data parsing
- **winston** and **morgan**: Logging utilities
- **express-rate-limit**: Rate limiting middleware

### Development Dependencies

- **eslint**: Code linting
