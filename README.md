# Node.js REST API with JWT Authentication

This project is a Node.js REST API that implements JWT authentication and integrates with the Genshare API for PDF processing. It features user-specific rate limiting, script-based user management, and secure token handling.

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

1. Clone the repository:
   ```
   git clone https://github.com/yourusername/genshare-api.git
   cd genshare-api
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

- If no file is uploaded, a 400 Bad Request error is returned.
  - HTTP 400: 'Required "file" missing' (parameter not set)
  - HTTP 400: 'Required "file" invalid. Must have mimetype "application/pdf".' (file with incorrect mimetype)
- If the `options` parameter is not a valid JSON object, a 400 Bad Request error is returned with a descriptive message.
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

If no error occured during the GenShare process, the response will be a JSON as below :

```
#TO DO : Add an example of a GenShare JSON
```

### Authentication

All routes in this API require authentication using JWT (JSON Web Tokens). To authenticate:

1. Obtain a token using the user management script:
   ```
   npm run manage-users add <userId>
   ```
   This will return a JWT token for the user.

2. Include this token in the `Authorization` header of all API requests:
   ```
   Authorization: Bearer <your_token>
   ```

3. If a token expires or becomes invalid, you can refresh it using:
   ```
   npm run manage-users refresh-token <userId>
   ```

Requests without a valid token will receive a 401 (Unauthorized) or 403 (Forbidden) response.

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
- `uploads/`: Temporary storage for uploaded files (automatically managed)

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
- Uploaded files are temporarily stored and then deleted after processing
- Rate limiting is implemented to prevent API abuse
- Sensitive configuration files (`users.json` and `genshare.json`) are not committed to version control

## Contributing

Please read [CONTRIBUTING.md](CONTRIBUTING.md) for details on our code of conduct and the process for submitting pull requests.

## License

This project is licensed under the MIT License - see the [LICENSE.md](LICENSE.md) file for details.
