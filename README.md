# Snapshot API

A Node.js REST API for processing PDF documents through OSI (Open Science Indicators) verification system. It integrates with DataSeer AI "Genshare" API, featuring JWT authentication, user-specific rate limiting, S3 storage for request data, and Google Sheets integration for summary logging.

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
- [Dependencies](#dependencies)

## Features

- PDF document processing via Genshare integration
- Multiple GenShare version support with user-specific access control
- Response filtering based on user permissions
- JWT-based authentication system
  - Permanent tokens for long-term API access
  - Temporary tokens for external integrations (OAuth 2.0 Password Grant)
- Role-based access control
- User-specific rate limiting
- AWS S3 storage integration
- Version-specific Google Sheets logging
- Health monitoring for all services
- Comprehensive logging system
- Version synchronization
- Complete request traceability
- Report generation with Google Sheets integration
- SQLite database for article-request mapping
- Endpoints for report retrieval by article ID or request ID

## Prerequisites

- Node.js (>= 20.18.0)
- Docker for containerization
- AWS Account (ECR & S3)
- Google Cloud Account (Sheets API)
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
cp conf/*.default conf/*
```

## Configuration

### Environment Variables (.env)
```env
JWT_SECRET=your_jwt_secret_key
TOKEN_EXPIRATION=3600  # Temporary token expiration in seconds (default: 1 hour)
PORT=3000
```

### Required Configuration Files

1. GenShare Configuration:
```json
// conf/genshare.json
{
  "defaultVersion": "v1.0.0",
  "versions": {
    "v1.0.0": {
      "processPDF": {
        "url": "http://localhost:5000/snapshot",
        "method": "POST",
        "apiKey": "your_genshare_api_key_for_v1"
      },
      "health": {
        "url": "http://localhost:5000/health",
        "method": "GET"
      },
      "googleSheets": {
        "spreadsheetId": "your-spreadsheet-id-for-v1",
        "sheetName": "v1_Sheet"
      },
      "responseMapping": {
        "getPath": ["A", "B", "C", /* ... */],
        "getResponse": {
          "article_id": 0,
          "das_presence": 1,
          /* ... other mappings */
        }
      }
    }
  }
}
```

2. Users Configuration:
```json
// conf/users.json
{
  "admin": {
    "token": "XXXX",
    "client_secret": "your_client_secret_here", // For temporary token authentication
    "rateLimit": {
      "max": 200,
      "windowMs": 0
    },
    "genshare": {
      "authorizedVersions": ["v1.0.0", "v2.0.0"],
      "defaultVersion": "v1.0.0",
      "availableFields": [],
      "restrictedFields": []
    },
    "reports": {
      "authorizedVersions": ["Report (v0.1)"],
      "defaultVersion": "Report (v0.1)"
    }
  }
}
```

3. Reports Configuration:
```json
// conf/reports.json
{
  "defaultVersion": "",
  "versions": {
    "Report (v0.1)": {
      "googleSheets": {
        "folder": {
          "default": "XXX"
        },
        "template": {
          "default": "XXX"
        },
        "permissions": {
          "default": "writer"
        },
        "sheets": {
          "TEMPLATE": {
            "cells": {
              "A1": "key1",
              "Z999": "key2"
            }
          }
        }
      },
      "JSON": {
        "availableFields": [
          "key1",
          "key2",
          "key3"
        ],
        "restrictedFields": []
      }
    }
  }
}
```

4. Permissions Configuration:
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
        "allowed": [],
        "blocked": []
      }
    },
    "/reports/search": {
      "GET": {
        "description": "Get reports by request ID",
        "allowed": ["admin"],
        "blocked": []
      }
    }
  }
}
```

5. AWS S3 (`conf/aws.s3.json`):
```json
{
  "accessKeyId": "YOUR_ACCESS_KEY",
  "secretAccessKey": "YOUR_SECRET_KEY",
  "region": "YOUR_REGION",
  "bucketName": "YOUR_BUCKET_NAME",
  "s3Folder": "YOUR-FOLDER-NAME"
}
```

6. Additional Configurations:
- `conf/grobid.json`: GROBID service settings
- `conf/datastet.json`: DataStet service settings
- `conf/googleSheets.credentials.json`: Google Sheets API credentials

## API Architecture

### Available Endpoints

```
# Authentication
POST   /editorial-manager/authenticate - Get temporary token using client credentials
POST   /editorial-manager/revokeToken       - Revoke a temporary token

# API routes
GET    /                       - List available API routes
GET    /ping                   - Health check all services
POST   /processPDF             - Process a PDF file (with optional genshareVersion and report parameters)
GET    /genshare/health        - Check GenShare service health (all authorized versions)
GET    /grobid/health          - Check GROBID service health
GET    /datastet/health        - Check DataStet service health
GET    /reports/search         - Get reports by article_id or request_id
POST   /requests/refresh       - Refresh article-request ID mapping from S3
```

## Authentication Flow

### Permanent Token Authentication (for direct API users)

1. Token Generation:
```bash
npm run manage-users -- add user123
# Output: User user123 added with token: eyJhbGciOiJ... and client_secret: a1b2c3d4...
```

2. Request Authentication:
```bash
curl -H "Authorization: Bearer <your-token>" http://localhost:3000/endpoint
```

### Temporary Token Authentication (for external systems)

1. Obtain a temporary token:
```bash
curl -X POST http://localhost:3000/editorial-manager/authenticate \
  -d "client_id=user123" \
  -d "client_secret=a1b2c3d4..." \
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

3. Revoke a temporary token (optional):
```bash
curl -X POST http://localhost:3000/editorial-manager/revokeToken \
  -d "token=eyJhbGciOiJ..."

# Response:
# {
#   "message": "Token revoked successfully"
# }
```

### Response Filtering

Users can have specific response filters configured:

```json
"genshare": {
  "availableFields": ["article_id", "das_presence"],
  "restrictedFields": []
}
```

If `availableFields` is set, only those fields will be included in the response.
If `restrictedFields` is set, those fields will be excluded from the response.
If both are empty, the full response is returned.

### GenShare Version and Report Selection

Users can specify which GenShare version and report to use:

```bash
curl -X POST http://localhost:3000/processPDF \
  -H "Authorization: Bearer <token>" \
  -F "file=@document.pdf" \
  -F 'options={"option1": "value1"}' \
  -F 'genshareVersion=v2.0.0' \
  -F 'report=Report (v0.1)'
```

If the requested version is not authorized for the user or not specified, the user's default version will be used.

### Rate Limiting

```json
{
  "max": 100,        // Maximum requests
  "windowMs": 900000 // Time window (15 minutes)
}
```

### Storage Architecture

S3 Storage Structure:
```
{s3Folder}/{userId}/{requestId}/
├── file.pdf              # Original PDF
├── file.metadata.json    # File metadata
├── options.json          # Processing options
├── process.json          # Process metadata
├── process.log           # Process log
├── response.json         # API response (full, unfiltered)
└── report.json           # Report data (if a report was generated)
```

### SQLite Database

The application uses SQLite to maintain two main tables:

1. Article-Request Mapping:
```
requests
├── id           # Primary key
├── user_name    # User who made the request
├── article_id   # Article ID from GenShare response
├── request_id   # Request ID generated by the API
└── created_at   # Timestamp when the record was created
```

2. Temporary Tokens:
```
temporary_tokens
├── id           # Primary key
├── client_id    # Client ID (user ID)
├── token        # JWT token
├── created_at   # Creation timestamp
├── expires_at   # Expiration timestamp
└── revoked      # Revocation flag (0/1)
```

### Error Handling

1. Authentication Errors:
```bash
# Invalid client credentials
curl -X POST http://localhost:3000/editorial-manager/authenticate \
     -d "client_id=invalid" \
     -d "client_secret=invalid" \
     -d "grant_type=password"
# Response: HTTP 401 {"error": "invalid_client", "error_description": "Invalid client credentials"}

# Missing parameters
curl -X POST http://localhost:3000/editorial-manager/authenticate \
     -d "client_id=user123"
# Response: HTTP 400 {"error": "invalid_request", "error_description": "Missing required parameters"}
```

2. File Errors:
```bash
# Missing file
curl -X POST -H "Authorization: Bearer <token>" \
     -F 'options={"key":"value"}' \
     http://localhost:3000/processPDF
# Response: HTTP 400 "Required 'file' missing"

# Invalid file type
curl -X POST -H "Authorization: Bearer <token>" \
     -F "file=@document.txt" \
     -F 'options={"key":"value"}' \
     http://localhost:3000/processPDF
# Response: HTTP 400 "Required 'file' invalid"
```

3. Options Errors:
```bash
# Missing options
curl -X POST -H "Authorization: Bearer <token>" \
     -F "file=@document.pdf" \
     http://localhost:3000/processPDF
# Response: HTTP 400 "Required 'options' missing"
```

4. GenShare Version Errors:
```bash
# Unauthorized GenShare version
curl -X POST -H "Authorization: Bearer <token>" \
     -F "file=@document.pdf" \
     -F 'options={"key":"value"}' \
     -F 'genshareVersion=v3.0.0'
# Response: Uses user's default version instead
```

## Usage

### Processing PDFs

```bash
# Process with default GenShare version
curl -X POST http://localhost:3000/processPDF \
  -H "Authorization: Bearer <token>" \
  -F "file=@document.pdf" \
  -F 'options={"option1": "value1"}'

# Process with specific GenShare version and report
curl -X POST http://localhost:3000/processPDF \
  -H "Authorization: Bearer <token>" \
  -F "file=@document.pdf" \
  -F 'options={"option1": "value1"}' \
  -F 'genshareVersion=v2.0.0' \
  -F 'report=Report (v0.1)'
```

### Retrieving Reports

```bash
# Get report by article ID
curl -G http://localhost:3000/reports/search \
  -H "Authorization: Bearer <token>" \
  --data-urlencode "article_id=ARTICLE123"

# Get report by request ID
curl -G http://localhost:3000/reports/search \
  -H "Authorization: Bearer <token>" \
  --data-urlencode "request_id=12345678901234567890123456789012"
```

### Managing Users

```bash
# Add user with custom rate limit and GenShare settings
npm run manage-users -- add user123 '{"max": 200, "windowMs": 900000}'

# List users
npm run manage-users -- list

# Update rate limit
npm run manage-users -- update-limit user123 '{"max": 300}'

# Refresh token
npm run manage-users -- refresh-token user123

# Refresh client secret (for temporary token authentication)
npm run manage-users -- refresh-client-secret user123

# Update GenShare settings
npm run manage-users -- update-genshare user123 '{"authorizedVersions": ["v1.0.0", "v2.0.0"], "defaultVersion": "v2.0.0"}'
```

### Managing GenShare Versions

```bash
# List all GenShare versions
npm run manage-genshare -- list

# Add a new GenShare version
npm run manage-genshare -- add v2.0.0 "http://localhost:5001/snapshot" "http://localhost:5001/health" "spreadsheet-id" "Sheet1" "api-key"

# Update a GenShare version
npm run manage-genshare -- update v2.0.0 --processPdfUrl "http://localhost:5002/snapshot"

# Set default GenShare version
npm run manage-genshare -- set-default v2.0.0

# Update response mapping
npm run manage-genshare -- update-mapping v2.0.0 getResponse '{"new_field": 28}'

# Remove a GenShare version
npm run manage-genshare -- remove v2.0.0
```

### Managing Permissions

```bash
# Add route permission
npm run manage-permissions -- add /processPDF POST '["user1","user2"]' '["user3"]'

# Allow user
npm run manage-permissions -- allow /processPDF POST user4

# Block user
npm run manage-permissions -- block /processPDF POST user5

# List permissions
npm run manage-permissions -- list
```

### Database Management

```bash
# Initialize database
npm run db:init

# Refresh requests from S3
npm run db:refresh

# Check request IDs for an article
npm run db:check <userName> <articleId>
```

## Scripts

### Server Management
```bash
# Start the server
npm run start

# Start the server in development mode (no DB refresh)
npm run start:dev
```

### User Management
```bash
# Add new user with default rate limit
npm run manage-users -- add user123
# Output: User user123 added with token: eyJhbGciOiJ...
# Output: Client Secret: a1b2c3d4...

# Add user with custom rate limit
npm run manage-users -- add user123 '{"max": 200, "windowMs": 900000}'
# Output: User user123 added with rate limit: {"max":200,"windowMs":900000}

# List all users
npm run manage-users -- list
# Output: Lists all users with their tokens and rate limits

# Refresh user token
npm run manage-users -- refresh-token user123
# Output: Token refreshed for user user123. New token: eyJhbGciOiJ...

# Refresh user client secret
npm run manage-users -- refresh-client-secret user123
# Output: Client secret refreshed for user user123. New client secret: a1b2c3d4...

# Update user rate limit
npm run manage-users -- update-limit user123 '{"max": 300}'
# Output: Rate limit updated for user user123: {"max":300,"windowMs":900000}

# Update user GenShare settings
npm run manage-users -- update-genshare user123 '{"authorizedVersions": ["v1.0.0", "v2.0.0"]}'
# Output: GenShare settings updated for user user123

# Remove user
npm run manage-users -- remove user123
# Output: User user123 removed
```

### Database Management
```bash
# Initialize the SQLite database (creates tables)
npm run db:init
# Output: Database initialized successfully

# Refresh requests from S3 to update database
npm run db:refresh
# Output: Requests refreshed successfully

# Check request IDs for a specific article
npm run db:check user123 ARTICLE456
# Output: Found X request IDs: [requestId1, requestId2, ...]
```

### GenShare Version Management
```bash
# List all GenShare versions
npm run manage-genshare -- list
# Output: Lists all configured GenShare versions

# Add new GenShare version
npm run manage-genshare -- add v2.0.0 "http://localhost:5001/snapshot" "http://localhost:5001/health" "spreadsheet-id" "Sheet1" "api-key"
# Output: Added GenShare version v2.0.0

# Update a GenShare version
npm run manage-genshare -- update v2.0.0 --processPdfUrl "http://localhost:5002/snapshot" --apiKey "new-key"
# Output: Updated GenShare version v2.0.0

# Set default GenShare version
npm run manage-genshare -- set-default v2.0.0
# Output: Default GenShare version set to v2.0.0

# Update response mapping
npm run manage-genshare -- update-mapping v2.0.0 getResponse '{"new_field": 28}'
# Output: Updated getResponse mapping for version v2.0.0

# Remove a GenShare version
npm run manage-genshare -- remove v2.0.0
# Output: Removed GenShare version v2.0.0
```

### Permission Management
```bash
# Add new route with permissions
npm run manage-permissions -- add /api/route GET '["user1"]' '["user2"]'
# Output: Route /api/route [GET] added with permissions

# Allow user access to route
npm run manage-permissions -- allow /api/route GET user3
# Output: User user3 allowed on route /api/route [GET]

# Block user from route
npm run manage-permissions -- block /api/route GET user2
# Output: User user2 blocked from route /api/route [GET]

# List all route permissions
npm run manage-permissions -- list
# Output: Displays all routes and their permissions
```

### Log Analysis
```bash
# Analyze default log file
npm run analyze-logs
# Output: Shows usage statistics from log/combined.log

# Analyze specific log file
npm run analyze-logs -- /path/to/custom.log
# Output: Shows usage statistics for specified log file

# Analysis includes:
# - Per-user statistics
# - Per-IP statistics
# - URL-specific breakdown
# - Success rates
```

### Code Quality
```bash
# Run ESLint check
npm run lint
# Output: Shows any code style violations

# Fix auto-fixable ESLint issues
npm run lint:fix
# Output: Fixes and shows remaining issues
```

### Version Management
```bash
# Sync version with git tags
npm run sync-version
# Output: Updates package.json version to match latest git tag

# Create new release
npm run release
# Effect: 
# 1. Bumps version based on conventional commits
# 2. Updates CHANGELOG.md
# 3. Creates version commit
# 4. Creates git tag
# 5. Pushes changes and tags
```

## Development

### Project Structure
```
.
├── src/
│   ├── server.js           # Entry point
│   ├── config.js           # Configuration
│   ├── middleware/         # Custom middleware
│   │   ├── auth.js         # Authentication middleware
│   │   └── permissions.js  # Permission middleware
│   ├── routes/             # API routes
│   │   └── index.js        # Main router
│   ├── controllers/        # Request handlers
│   │   ├── apiController.js       # API routes controller
│   │   ├── authController.js      # Authentication controller
│   │   ├── datastetController.js  # DataStet service controller
│   │   ├── genshareController.js  # GenShare service controller
│   │   ├── grobidController.js    # GROBID service controller
│   │   ├── healthController.js    # Health checks controller
│   │   ├── reportsController.js   # Reports controller
│   │   ├── requestsController.js  # Requests management controller
│   │   └── versionsController.js  # Versions controller
│   └── utils/              # Utility functions
│       ├── dbManager.js           # Database operations
│       ├── googleSheets.js        # Google Sheets integration
│       ├── jwtManager.js          # JWT token management
│       ├── logger.js              # Logging functionality
│       ├── permissionsManager.js  # Permission management
│       ├── rateLimiter.js         # Rate limiting
│       ├── reportsManager.js      # Report generation
│       ├── requestsManager.js     # Request tracking
│       ├── s3Storage.js           # AWS S3 integration
│       ├── userManager.js         # User management
│       └── versions.js            # Version utilities
├── scripts/                # Management scripts
│   ├── analyze_logs.js           # Log analysis
│   ├── manage_genshare_versions.js # GenShare version management
│   ├── manage_permissions.js     # Permission management
│   ├── manage_users.js           # User management
│   ├── sync_version.js           # Version synchronization
│   └── maintenance/              # Database maintenance scripts
│       └── initDB.js             # Database initialization
├── conf/                   # Configuration files
│   ├── aws.s3.json               # AWS S3 configuration
│   ├── datastet.json             # DataStet configuration
│   ├── genshare.json             # GenShare configuration
│   ├── googleSheets.credentials.json # Google Sheets credentials
│   ├── grobid.json               # GROBID configuration 
│   ├── permissions.json          # API permissions
│   ├── reports.json              # Reports configuration
│   └── users.json                # User configuration
├── sqlite/                 # SQLite database files
└── tmp/                    # Temporary files
```

### Setting Up Development Environment

1. Clone and setup:
```bash
git clone https://github.com/DataSeer/snapshot-api.git
cd snapshot-api
npm install
```

2. Configure development environment:
```bash
cp .env.default .env
cp conf/*.default conf/*
```

3. Initialize database:
```bash
npm run db:init
```

### Commit Guidelines

Follow Conventional Commits specification:
```bash
# Format
<type>: <description>

# Examples
feat: add new PDF processing option
fix: resolve rate limiting issue
docs: update API documentation
refactor: improve error handling
```

### Version Management

```bash
# Create new version
npm run release

# Manual version tag
git tag v1.1.0
git push origin v1.1.0
```

## Deployment

### Docker Deployment

The application can be easily deployed using Docker:

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

### AWS Deployment

For AWS deployment, the application can be containerized and deployed on:

1. Amazon ECS (Elastic Container Service)
2. Amazon EKS (Elastic Kubernetes Service)
3. AWS Fargate (Serverless)

Example ECS deployment configuration:

```yaml
# task-definition.json
{
  "family": "snapshot-api",
  "networkMode": "awsvpc",
  "executionRoleArn": "arn:aws:iam::123456789012:role/ecsTaskExecutionRole",
  "containerDefinitions": [
    {
      "name": "snapshot-api",
      "image": "123456789012.dkr.ecr.us-west-2.amazonaws.com/snapshot-api:latest",
      "essential": true,
      "portMappings": [
        {
          "containerPort": 3000,
          "hostPort": 3000,
          "protocol": "tcp"
        }
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/snapshot-api",
          "awslogs-region": "us-west-2",
          "awslogs-stream-prefix": "ecs"
        }
      },
      "secrets": [
        {
          "name": "JWT_SECRET",
          "valueFrom": "arn:aws:ssm:us-west-2:123456789012:parameter/snapshot-api/jwt-secret"
        }
      ]
    }
  ],
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "256",
  "memory": "512"
}
```

## Security

- JWT-based authentication required for all routes
  - Permanent tokens for direct API access
  - Temporary tokens with expiration for external integrations
  - Token revocation capability for temporary tokens
- Route-specific access control
- User-specific rate limiting
- User-specific GenShare version access
- Response filtering based on user permissions
- Secure token storage and management
- Request logging and monitoring
- S3 storage for complete request traceability
- Automated security scanning in CI/CD
- Regular token rotation recommended
- Access logs monitoring for suspicious activity
- Principle of least privilege for AWS IAM

### Temporary JWT

Here is an example of how to add a custom authentication (temporary JWT)

```js
/**
 * Example of another authentication method with different fields and additional validation
 * 
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const authenticateCustomSystem = async (req, res) => {
  // Configuration for a custom system authentication
  const options = {
    clientIdField: 'api_key',               // Different field name
    clientSecretField: 'api_secret',        // Different field name
    grantTypeField: 'auth_type',            // Different field name
    grantTypeValue: 'client_credentials',   // Different grant type
    additionalFields: {                     // Additional fields to extract
      scope: 'requested_scope',
      system: 'system_id'
    },
    tokenExpirationOverride: 7200,          // 2 hours instead of default
    additionalValidation: async (clientId, extraFields, req) => {
      // Example validation: Check if the requested scope is valid for this client
      if (extraFields.scope && !['read', 'write', 'admin'].includes(extraFields.scope)) {
        return {
          isValid: false,
          status: 400,
          error: 'invalid_scope',
          message: 'Requested scope is not supported'
        };
      }
      
      // Example: Check system ID
      if (extraFields.system !== 'system1' && extraFields.system !== 'system2') {
        return {
          isValid: false,
          status: 400,
          error: 'invalid_system',
          message: 'System ID is not recognized'
        };
      }
      
      return { isValid: true };
    },
    responseTransform: (response, tokenData, extraFields) => {
      // Add additional fields to the response
      return {
        ...response,
        scope: extraFields.scope || 'read', // Default to 'read' if not specified
        system: extraFields.system
      };
    }
  };
  
  return authenticate(options, req, res);
};

/**
 * Example of a custom token revocation method
 * 
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const revokeTokenCustomSystem = async (req, res) => {
  // Configuration for Custom System token revocation
  const options = {
    tokenField: 'access_token',            // Different field name
    clientIdField: 'api_key',              // Different field name
    clientSecretField: 'api_secret',       // Different field name
    additionalValidation: async (clientId, token, extraFields, req, isTokenAuth) => {
      // Example: Add additional validation logic
      // isTokenAuth is true if authentication was done using the token itself
      if (extraFields.system && extraFields.system !== 'system1' && extraFields.system !== 'system2') {
        return {
          isValid: false,
          status: 400,
          error: 'invalid_system',
          message: 'System ID is not recognized'
        };
      }
      
      return { isValid: true };
    },
    responseTransform: (response, success, extraFields) => {
      // Customize the response
      return {
        ...response,
        system: extraFields.system || 'unknown',
        timestamp: new Date().toISOString()
      };
    }
  };
  
  return revokeToken(options, req, res);
};
```

## Dependencies

### Production
```json
{
  "aws-sdk": "^2.1692.0",
  "axios": "^1.9.0",
  "express": "^4.17.1",
  "express-rate-limit": "^5.2.6",
  "form-data": "^4.0.0",
  "googleapis": "^144.0.0",
  "jsonwebtoken": "^9.0.2",
  "sqlite3": "^5.1.6",
  "winston": "^3.15.0"
}
```

### Development
```json
{
  "@commitlint/cli": "^19.6.1",
  "@commitlint/config-conventional": "^19.6.0",
  "eslint": "^8.56.0",
  "husky": "^8.0.3",
  "standard-version": "^9.5.0"
}
```