# Snapshot API

A Node.js REST API for processing PDF documents through OSI (Open Science Indicators) verification system. It integrates with DataSeer AI "Genshare" API, featuring JWT authentication, user-specific rate limiting, S3 storage for request data, and Google Sheets integration for summary logging.

## Table of Contents

- [Features](#features)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
- [API Architecture](#api-architecture)
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
- Role-based access control
- User-specific rate limiting
- AWS S3 storage integration
- Version-specific Google Sheets logging
- Health monitoring for all services
- Comprehensive logging system
- Version synchronization
- Complete request traceability

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
    "rateLimit": {
      "max": 200,
      "windowMs": 0
    },
    "genshare": {
      "authorizedVersions": ["v1.0.0", "v2.0.0"],
      "defaultVersion": "v1.0.0",
      "responseFilter": {
        "availableFields": [],
        "restrictedFields": []
      }
    }
  }
}
```

3. AWS S3 (`conf/aws.s3.json`):
```json
{
  "accessKeyId": "YOUR_ACCESS_KEY",
  "secretAccessKey": "YOUR_SECRET_KEY",
  "region": "YOUR_REGION",
  "bucketName": "YOUR_BUCKET_NAME",
  "s3Folder": "YOUR-FOLDER-NAME"
}
```

4. Additional Configurations:
- `conf/grobid.json`: GROBID service settings
- `conf/datastet.json`: DataStet service settings
- `conf/permissions.json`: Route permissions
- `conf/googleSheets.credentials.json`: Google Sheets API credentials

## API Architecture

### Available Endpoints

```
GET    /                  - List available API routes
GET    /versions          - Get version information
POST   /processPDF        - Process a PDF file (with optional genshareVersion parameter)
GET    /ping              - Health check all services
GET    /genshare/health   - Check GenShare service health (all authorized versions)
GET    /grobid/health     - Check GROBID service health
GET    /datastet/health   - Check DataStet service health
```

### Authentication Flow

1. Token Generation:
```bash
npm run manage-users -- add user123
# Output: User user123 added with token: eyJhbGciOiJ...
```

2. Request Authentication:
```bash
curl -H "Authorization: Bearer <your-token>" http://localhost:3000/endpoint
```

### Response Filtering

Users can have specific response filters configured:

```json
"responseFilter": {
  "availableFields": ["article_id", "das_presence"],
  "restrictedFields": []
}
```

If `availableFields` is set, only those fields will be included in the response.
If `restrictedFields` is set, those fields will be excluded from the response.
If both are empty, the full response is returned.

### GenShare Version Selection

Users can specify which GenShare version to use:

```bash
curl -X POST http://localhost:3000/processPDF \
  -H "Authorization: Bearer <token>" \
  -F "file=@document.pdf" \
  -F 'options={"option1": "value1"}' \
  -F 'genshareVersion=v2.0.0'
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
└── response.json         # API response (full, unfiltered)
```

### Error Handling

1. File Errors:
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

2. Options Errors:
```bash
# Missing options
curl -X POST -H "Authorization: Bearer <token>" \
     -F "file=@document.pdf" \
     http://localhost:3000/processPDF
# Response: HTTP 400 "Required 'options' missing"
```

3. GenShare Version Errors:
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

# Process with specific GenShare version
curl -X POST http://localhost:3000/processPDF \
  -H "Authorization: Bearer <token>" \
  -F "file=@document.pdf" \
  -F 'options={"option1": "value1"}' \
  -F 'genshareVersion=v2.0.0'
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

# Remove a GenShare version
npm run manage-genshare -- remove v2.0.0
```

### Managing Permissions

```bash
# Add route permission
npm run manage-permissions -- add /processPDF POST '["user1","user2"]' '["user3"]'

# Allow user
npm run manage-permissions -- allow /processPDF POST user4

# List permissions
npm run manage-permissions -- list
```

## Scripts

### Server Management
```bash
# Start the server
npm run start
```

### User Management
```bash
# Add new user with default rate limit
npm run manage-users -- add user123
# Output: User user123 added with token: eyJhbGciOiJ...

# Add user with custom rate limit
npm run manage-users -- add user123 '{"max": 200, "windowMs": 900000}'
# Output: User user123 added with rate limit: {"max":200,"windowMs":900000}

# List all users
npm run manage-users -- list
# Output: Lists all users with their tokens and rate limits

# Refresh user token
npm run manage-users -- refresh-token user123
# Output: Token refreshed for user user123. New token: eyJhbGciOiJ...

# Update user rate limit
npm run manage-users -- update-limit user123 '{"max": 300}'
# Output: Rate limit updated for user user123: {"max":300,"windowMs":900000}

# Remove user
npm run manage-users -- remove user123
# Output: User user123 removed
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
│   ├── routes/             # API routes
│   ├── controllers/        # Request handlers
│   └── utils/              # Utility functions
├── scripts/                # Management scripts
├── conf/                   # Configuration files
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

## Security

- JWT-based authentication required for all routes
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

## Dependencies

### Production
```json
{
  "aws-sdk": "^2.1692.0",
  "axios": "^1.7.7",
  "express": "^4.17.1",
  "express-rate-limit": "^5.2.6",
  "form-data": "^4.0.0",
  "googleapis": "^144.0.0",
  "jsonwebtoken": "^9.0.2",
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