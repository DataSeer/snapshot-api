# Snapshot API 

The Snapshot API allow processing of PDF documents through a verification system in respect of the OSI (Open Science Indicators). 
This project provides a Node.js REST API that implements JWT authentication and integrates with the DataSeer AI "Genshare" API for PDF processing. It features user-specific rate limiting, script-based user management, and secure token handling.

## Features

- JWT-based authentication for all routes
- PDF processing via Genshare API integration
- User-specific rate limiting
- Script-based user management (add, remove, refresh tokens, update rate limits)
- Secure token handling

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
   - Create `conf/genshare.json` with your Genshare API details:
     ```json
      {
        "processPDF": {
          "url": "http://localhost:5000/process/pdf",
          "method": "POST",
          "apiKey": "your_genshare_api_key_for_process_pdf"
        }
      }
     ```
   - The `conf/users.json` file will be created automatically when you add users.

4. Set environment variables:
   - `PORT`: The port on which the server will run (default: 3000)
   - `JWT_SECRET`: Secret key for JWT token generation and validation

## Usage

### Starting the Server

To start the server in production mode :

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

Rate limits are specified as a JSON object with `max` (maximum number of requests) and `windowMs` (time window in milliseconds) properties. If not specified when adding a user, it defaults to 100 requests per 15-minute window.

### API Endpoints

All API endpoints require authentication using a JWT token.

- `GET /`: Get information about available API routes
  - Requires authentication

- `POST /processPDF`: Process a PDF file
  - Requires authentication
  - Form data:
    - `file`: PDF file
    - `options`: JSON string of processing options
  - The `options` parameter must be a valid JSON object. If it's not well-formed or is not a valid JSON object, the API will return a 400 Bad Request error.

For all requests, include the JWT token in the Authorization header:

```
Authorization: Bearer <your_token>
```

Example curl commands:

1. Get API information:
```
curl -H "Authorization: Bearer <your_token>" http://localhost:3000/
```

2. Process a PDF with options:
```
curl -X POST -H "Authorization: Bearer <your_token>" \
     -F "file=@path/to/your/file.pdf" \
     -F 'options={"key":"value","anotherKey":123}' \
     http://localhost:3000/processPDF
```

Note: Ensure that the `options` parameter is a valid JSON object. Invalid JSON will result in an error response.

### Error Handling

- If the `file` parameter is not provided, a 400 Bad Request error is returned.
  - HTTP 400: 'Required "file" missing' (parameter not set)
  - HTTP 400: 'Required "file" invalid. Must have mimetype "application/pdf".' (file with incorrect mimetype)
- If the `options` parameter is not provided or not a valid JSON object, a 400 Bad Request error is returned with a descriptive message.
  - HTTP 400: 'Required "options" missing.' (parameter not set)
  - HTTP 400: 'Required "options" invalid. Must be a valid JSON object.' (data are not JSON)
  - HTTP 400: 'Required "options" invalid. Must be a JSON object.' (data are JSON but not an object)
- If an error occurs during the GenShare process, the GenShare HTTP status code is returned.

#### "file" errors

HTTP 400: 'Required "file" missing' (parameter not set)
```
curl -X POST -H "Authorization: Bearer <your_token>" \
     -F 'options={"key":"value","anotherKey":123}' \
     http://localhost:3000/processPDF
# HTTP 400 Bad Request 
Required "file" missing
```

HTTP 400: 'Required "file" invalid. Must have mimetype "application/pdf".' (file with incorrect mimetype)
```
curl -X POST -H "Authorization: Bearer <your_token>" \
     -F "file=@path/to/your/file.xml" \
     -F 'options={"key":"value","anotherKey":123}' \
     http://localhost:3000/processPDF
# HTTP 400 Bad Request 
Required "file" invalid. Must have mimetype "application/pdf".
```

#### "options" errors

HTTP 400: 'Required "options" missing.' (parameter not set)
```
curl -X POST -H "Authorization: Bearer <your_token>" \
     -F "file=@path/to/your/file.pdf" \
     http://localhost:3000/processPDF
# HTTP 400 Bad Request 
Required "options" missing.
```

HTTP 400: 'Required "options" invalid. Must be a valid JSON object.' (data are not JSON)
```
curl -X POST -H "Authorization: Bearer <your_token>" \
     -F "file=@path/to/your/file.pdf" \
     -F 'options="key value anotherKey 123"' \
     http://localhost:3000/processPDF
# HTTP 400 Bad Request 
Required "options" invalid. Must be a valid JSON object.
```

HTTP 400: 'Required "options" invalid. Must be a JSON object.' (data are JSON but not an object)
```
curl -X POST -H "Authorization: Bearer <your_token>" \
     -F "file=@path/to/your/file.pdf" \
     -F 'options=["key","value","anotherKey",123]' \
     http://localhost:3000/processPDF
# HTTP 400 Bad Request 
Required "options" invalid. Must be a JSON object.
```

### GenShare Response

[More info available here](USER_DOCUMENTATION.md#example-response-1)

## Authentication

The API uses JSON Web Tokens (JWT) for authentication, implemented through several components:

### Token Management

- `TokenManager`: Handles token storage and validation
- `UserManager`: Manages user data and updates
- Tokens are stored in `conf/users.json` separate from user data for security

### Token Lifecycle

1. **Creation**: Tokens are generated using:
   ```bash
   npm run manage-users add <userId>
   ```
   This creates a JWT signed with the application's secret key containing the user ID.

2. **Usage**: Include token in requests:
   ```bash
   curl -H "Authorization: Bearer <your_token>" http://localhost:3000/endpoint
   ```

3. **Validation**: Each request is authenticated by:
   - Extracting token from Authorization header
   - Verifying JWT signature
   - Looking up associated user
   - Checking rate limits

4. **Renewal**: Refresh expired tokens using:
   ```bash
   npm run manage-users refresh-token <userId>
   ```

### User Management Commands

```bash
# Generate new user with token
npm run manage-users add user123

# List all users and their tokens
npm run manage-users list

# Refresh token for existing user
npm run manage-users refresh-token user123

# Remove user and invalidate token
npm run manage-users remove user123
```

### Security Features

- JWT tokens are signed with a secret key (`JWT_SECRET` environment variable)
- Tokens are stored separately from user data
- Rate limiting is tied to authentication
- Invalid tokens return 401 Unauthorized
- Missing tokens return 403 Forbidden

## Project Structure

- `src/`: Contains the main application code
  - `server.js`: Entry point
  - `config.js`: Configuration management
  - `middleware/`: Custom middleware (e.g., authentication)
  - `routes/`: API route definitions
  - `controllers/`: Request handling logic
  - `utils/`: Utility functions and classes
- `scripts/`: Contains the user management script
- `conf/`: Configuration files
  - `genshare.json`: Genshare API configuration
  - `users.json`: User data storage (managed by scripts)

## Configuration Files

The application uses two main configuration files:

- `conf/genshare.json`: Contains configuration for the Genshare API integration.
- `conf/users.json`: Stores user data, including tokens and rate limits.

Make sure to keep these files secure and do not commit them to version control.

## Rate Limiting

This API implements user-specific rate limiting:

- Rate limits are customized for each user and stored in their user data.
- Unauthenticated requests are limited to 100 requests per 15-minute window.
- Authenticated requests use the limits specified in the user's data:
  - `max`: Maximum number of requests allowed in the time window
  - `windowMs`: Time window in milliseconds
  - If not specified, defaults to 100 requests per 15-minute window
- To give a user unlimited requests, set `windowMs` to 0 when adding or updating the user

Rate limiting is implemented in `src/utils/rateLimiter.js` and can be further customized as needed.

## Security Considerations

- All routes require JWT authentication
- JWT tokens are stored separately and managed through a dedicated script
- The main application can only read tokens, not modify them
- Rate limiting is implemented to prevent API abuse
- Sensitive configuration files (`users.json` and `genshare.json`) are not committed to version control

## Logging System

The API implements comprehensive logging using Winston and Morgan:

### Log Format
- Each log entry contains:
  - IP address
  - User ID (or 'unauthenticated')
  - Timestamp
  - HTTP method and URL
  - Status code
  - Response size
  - Referrer
  - User agent
  - Request success status

### Log Analysis

The project includes a log analysis script that provides detailed statistics about API usage:

```bash
# analyze log/combined.log file
npm run analyze-logs

# analyze a given log file
node scripts/analyze_logs.js [path/to/logfile]
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

## Contributing

Please read [CONTRIBUTING.md](CONTRIBUTING.md) for details on our code of conduct and the process for submitting pull requests.

## License

This project is licensed under the MIT License - see the [LICENSE.md](LICENSE.md) file for details.
