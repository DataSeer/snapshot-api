# Snapshot API 

The Snapshot API allow processing of PDF documents through a verification system in respect of the OSI (Open Science Indicators). 
This project provides a Node.js REST API that implements JWT authentication and integrates with the DataSeer AI "Genshare" API for PDF processing. It features user-specific rate limiting, script-based user management, and secure token handling.

## Table of Contents

1. [Features](#features)
2. [Prerequisites](#prerequisites)
3. [Installation](#installation)
   - [Using Docker](#using-docker)
   - [Direct Installation](#direct-installation)
4. [Usage](#usage)
   - [Starting the Server](#starting-the-server)
   - [Managing Users](#managing-users)
   - [API Endpoints](#api-endpoints)
5. [Health Monitoring](#health-monitoring)
   - [Health Endpoints](#health-endpoints)
   - [Health Response Format](#health-response-format)
   - [Health Status Codes](#health-status-codes)
   - [Health Configuration](#health-configuration)
6. [Error Handling](#error-handling)
   - ["file" Errors](#file-errors)
   - ["options" Errors](#options-errors)
7. [GenShare Response](#genshare-response)
8. [Authentication](#authentication)
   - [Token Management](#token-management)
   - [Token Lifecycle](#token-lifecycle)
   - [User Management Commands](#user-management-commands)
   - [Security Features](#security-features)
9. [Project Structure](#project-structure)
10. [Configuration Files](#configuration-files)
11. [Rate Limiting](#rate-limiting)
12. [Logging System](#logging-system)
    - [Log Format](#log-format)
    - [Log Analysis](#log-analysis)
13. [Security Considerations](#security-considerations)
14. [Contributing](#contributing)
15. [License](#license)

## Features

- JWT-based authentication for all routes
- PDF processing via Genshare API integration
- User-specific rate limiting
- Script-based user management (add, remove, refresh tokens, update rate limits)
- Secure token handling
- Health monitoring for all dependent services

## Prerequisites

- Node.js (v14+ recommended)
- npm (comes with Node.js)

## Installation

### Using Docker

1. Clone the repository:
   ```
   git clone https://github.com/DataSeer/snapshot-api.git
   cd snapshot-api
   ```

2. Build image:
   ```
   docker build -t snapshot-api .
   ```

3. Run container:
   ```
   # using default conf & env files
   docker run -d -it -p 3000:3000 --network host --name snapshot-api-instance snapshot-api

   # using custom conf & env files
   docker run -d -it -p 3000:3000 --network host --name snapshot-api-instance -v $(pwd)/.env:/usr/src/app/.env -v $(pwd)/conf:/usr/src/app/conf snapshot-api
   ```

4. Interact with the container:
   ```
   # using default conf & env files
   docker exec -it snapshot-api-instance /bin/bash
   ```

### Direct Installation

1. Clone the repository:
   ```
   git clone https://github.com/DataSeer/snapshot-api.git
   cd snapshot-api
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Set up configuration:
   - Create service configuration files in the `conf` directory:
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

     // conf/grobid.json
     {
       "health": {
         "url": "http://localhost:8070/health",
         "method": "GET"
       }
     }

     // conf/datastet.json
     {
       "health": {
         "url": "http://localhost:8080/health",
         "method": "GET"
       }
     }
     ```
   - The `conf/users.json` file will be created automatically when you add users.

4. Set environment variables:
   - `PORT`: The port on which the server will run (default: 3000)
   - `JWT_SECRET`: Secret key for JWT token generation and validation

## Usage

### Starting the Server

To start the server in production mode:

```
npm start
```

### Managing Users

Use the following command to manage users:

```
npm run manage-users <command> [userId] [options]
```

Commands:
- `add [userId] [rateLimit]`: Add a new user
- `remove <userId>`: Remove a user
- `refresh-token <userId>`: Refresh a user's token
- `update-limit <userId> <rateLimit>`: Update a user's rate limit
- `list`: List all users

Examples:
```bash
# Add a new user with custom rate limit
npm run manage-users add user123 '{"max": 200, "windowMs": 900000}'

# Refresh a user's token
npm run manage-users refresh-token user123

# Update a user's rate limit
npm run manage-users update-limit user123 '{"max": 300}'

# List all users
npm run manage-users list

# Remove a user
npm run manage-users remove user123
```

### API Endpoints

All API endpoints require authentication using a JWT token.

- `GET /`: Get information about available API routes
- `POST /processPDF`: Process a PDF file
  - Form data:
    - `file`: PDF file
    - `options`: JSON string of processing options

For all requests, include the JWT token in the Authorization header:
```
Authorization: Bearer <your_token>
```

## Health Monitoring

The API provides comprehensive health monitoring for all dependent services (GenShare, GROBID, and DataStet).

### Health Endpoints

- `GET /ping`: Check health status of all services
  - Returns aggregated health status of all services
  - Response includes timestamp and detailed service status

- `GET /genshare/health`: Direct health check proxy to GenShare service
  - Returns the raw response from GenShare's health endpoint
  - Returns 500 with message "GenShare health check failed" if the request fails

- `GET /grobid/health`: Direct health check proxy to GROBID service
  - Returns the raw response from GROBID's health endpoint
  - Returns 500 with message "Grobid health check failed" if the request fails

- `GET /datastet/health`: Direct health check proxy to DataStet service
  - Returns the raw response from DataStet's health endpoint
  - Returns 500 with message "Datastet health check failed" if the request fails

These individual health endpoints act as direct proxies to their respective services, forwarding the raw response data when successful. In case of failure, they return a 500 status code with a service-specific error message.

### Health Response Format

The `/ping` endpoint returns:

```json
{
  "status": "healthy" | "unhealthy" | "error",
  "timestamp": "2024-12-02T12:00:00.000Z",
  "services": {
    "genshare": {
      "err": null,
      "request": "GET http://genshare-service/health",
      "response": {
        "status": 200,
        "data": { /* service-specific health data */ }
      }
    },
    "grobid": {
      "err": null,
      "request": "GET http://grobid-service/health",
      "response": {
        "status": 200,
        "data": { /* service-specific health data */ }
      }
    },
    "datastet": {
      "err": null,
      "request": "GET http://datastet-service/health",
      "response": {
        "status": 200,
        "data": { /* service-specific health data */ }
      }
    }
  }
}
```

Individual service endpoints return:
```json
{
  "err": null,
  "request": "GET http://service-name/health",
  "response": {
    "status": 200,
    "data": { /* service-specific health data */ }
  }
}
```

### Health Status Codes

- 200: All services are healthy
- 503: One or more services are unhealthy
- 500: Error occurred while checking service health

### Health Configuration

Each service requires health check configuration in its respective config file:

```json
{
  "health": {
    "url": "http://service-url/health",
    "method": "GET"
  }
}
```

The analyzer provides:
- Per-user statistics:
  - Total requests
  - Successful requests
  - Success rate
  - URL-specific breakdown
- Per-IP statistics:
  - Similar metrics as per-user
  - Useful for tracking unauthenticated requests

Example output:
```
Request Statistics:

USERS Statistics:
User: user123
  Total Requests: 150
  Successful Requests: 145
  Overall Success Rate: 96.67%
  URL Breakdown:
    URL: /processPDF
      Total Requests: 120
      Successful Requests: 118
      Success Rate: 98.33%

IPS Statistics:
IP: 192.168.1.1
  Total Requests: 75
  Successful Requests: 70
  Overall Success Rate: 93.33%
  ...
```

## Security Considerations

- All routes require JWT authentication
- JWT tokens are stored separately and managed through a dedicated script
- The main application can only read tokens, not modify them
- Rate limiting is implemented to prevent API abuse
- Sensitive configuration files (`users.json` and `genshare.json`) are not committed to version control

## Contributing

Please read [CONTRIBUTING.md](CONTRIBUTING.md) for details on our code of conduct and the process for submitting pull requests.

## License

This project is licensed under the MIT License - see the [LICENSE.md](LICENSE.md) file for details.
