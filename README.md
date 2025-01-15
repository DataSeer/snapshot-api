# Snapshot API

A Node.js REST API for processing PDF documents through OSI (Open Science Indicators) verification system. It integrates with DataSeer AI "Genshare" API, featuring JWT authentication, user-specific rate limiting, S3 storage for request data, and Google Sheets integration for summary logging.

## Table of Contents

- [Features](#features)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
- [API Architecture](#api-architecture)
- [Usage](#usage)
- [Development](#development)
- [Deployment](#deployment)
- [Contributing](#contributing)
- [Scripts](#scripts)
- [Security](#security)

## Features

- PDF document processing via Genshare integration
- JWT-based authentication system
- Role-based access control
- User-specific rate limiting
- AWS S3 storage integration
- Google Sheets logging integration
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
  - GenShare service

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

1. Service Configuration:
```json
// conf/genshare.json
{
  "processPDF": {
    "url": "http://localhost:5000/process/pdf",
    "method": "POST",
    "apiKey": "your_genshare_api_key"
  },
  "health": {
    "url": "http://localhost:5000/health",
    "method": "GET"
  }
}
```

2. AWS S3 (`conf/aws.s3.json`):
```json
{
  "accessKeyId": "YOUR_ACCESS_KEY",
  "secretAccessKey": "YOUR_SECRET_KEY",
  "region": "YOUR_REGION",
  "bucketName": "YOUR_BUCKET_NAME",
  "s3Folder": "YOUR-FOLDER-NAME"
}
```

3. Additional Configurations:
- `conf/grobid.json`: GROBID service settings
- `conf/datastet.json`: DataStet service settings
- `conf/permissions.json`: Route permissions
- `conf/users.json`: User management
- `conf/googleSheets.json` & `conf/googleSheets.credentials.json`: Google Sheets integration

## API Architecture

### Available Endpoints

```
GET    /                  - List available API routes
GET    /versions         - Get version information
POST   /processPDF       - Process a PDF file
GET    /ping             - Health check all services
GET    /genshare/health  - Check GenShare service health
GET    /grobid/health    - Check GROBID service health
GET    /datastet/health  - Check DataStet service health
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
├── options.json         # Processing options
├── process.json         # Process metadata
├── process.log          # Process log
└── response.json        # API response
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

## Usage

### Processing PDFs

```bash
curl -X POST http://localhost:3000/processPDF \
  -H "Authorization: Bearer <token>" \
  -F "file=@document.pdf" \
  -F 'options={"option1": "value1"}'
```

### Managing Users

```bash
# Add user with custom rate limit
npm run manage-users -- add user123 '{"max": 200, "windowMs": 900000}'

# List users
npm run manage-users -- list

# Update rate limit
npm run manage-users -- update-limit user123 '{"max": 300}'

# Refresh token
npm run manage-users -- refresh-token user123
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

## Development

### Project Structure
```
.
├── src/
│   ├── server.js           # Entry point
│   ├── config.js           # Configuration
│   ├── middleware/         # Custom middleware
│   ├── routes/            # API routes
│   ├── controllers/       # Request handlers
│   └── utils/            # Utility functions
├── scripts/               # Management scripts
├── conf/                 # Configuration files
└── tmp/                  # Temporary files
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

Supported types (from .versionrc.json):
- feat: Features
- fix: Bug Fixes
- docs: Documentation
- style: Styling
- refactor: Code Refactoring
- perf: Performance Improvements
- test: Tests
- build: Build System
- ci: CI Implementation
- chore: Maintenance

### Version Management

```bash
# Create new version
npm run release

# Manual version tag
git tag v1.1.0
git push origin v1.1.0
```

## Scripts

```bash
npm run start              # Start server
npm run manage-permissions # Manage permissions
npm run manage-users      # Manage users
npm run analyze-logs      # Analyze logs
npm run lint             # Run ESLint
npm run lint:fix         # Fix ESLint issues
npm run prepare         # Install Husky
npm run sync-version    # Sync version
npm run version        # Update changelog
npm run post-version   # Push changes
npm run release       # Create release
```

## Security

- JWT-based authentication required for all routes
- Route-specific access control
- User-specific rate limiting
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