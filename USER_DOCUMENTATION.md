# Snapshot API Endpoints Documentation

This document provides detailed information about the available endpoints in the Snapshot API, along with examples of how to interact with them.

## Authentication

All endpoints require JWT authentication. API tokens are provided by DataSeer. To use the API, include your provided JWT token in the Authorization header of every request:

```
Authorization: Bearer <your_token>
```

If you need an API token or have issues with authentication, please contact DataSeer support.

## Endpoints

### 1. Get API Information

Return information about available API routes.

- **URL**: `/`
- **Method**: `GET`
- **Authentication**: Required

#### Example Request

Using curl:

```bash
curl -H "Authorization: Bearer <your_token>" https://snapshot.dataseer.ai/
```

Using JavaScript (with fetch):

```javascript
fetch('https://snapshot.dataseer.ai/', {
  headers: {
    'Authorization': 'Bearer <your_token>'
  }
})
.then(response => response.json())
.then(data => console.log(data))
.catch(error => console.error('Error:', error));
```

#### Example Response

```json
{
  "routes": [
    {
      "path": "/",
      "method": "GET",
      "description": "Get API information"
    },
    {
      "path": "/processPDF",
      "method": "POST",
      "description": "Process a PDF file"
    }
  ],
  "version": "1.0.0"
}
```

Note: The version field in the response corresponds to the version specified in the API's package.json file.

### 2. Process PDF

Process a PDF with GenShare.

- **URL**: `/processPDF`
- **Method**: `POST`
- **Authentication**: Required
- **Content-Type**: `multipart/form-data`

#### Request Parameters

| Field    | Type   | Description                                |
|----------|--------|--------------------------------------------|
| file     | File   | The PDF file to be processed (required)    |
| options  | String | JSON string of processing options (required) |

The `options` parameter must contain one mandatory field: 
- `document-type`: specify the type of the document sent (see example below)

#### Example Request

Using curl:

```bash
curl -X POST -H "Authorization: Bearer <your_token>" \
     -F "file=@path/to/your/file.pdf" \
     -F 'options={"document-type": "article"}' \
     https://snapshot.dataseer.ai/processPDF
```

Using JavaScript (with fetch):

```javascript
const formData = new FormData();
formData.append('file', fileInput.files[0]);
formData.append('options', JSON.stringify({
  // options data
}));

fetch('https://snapshot.dataseer.ai/processPDF', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer <your_token>'
  },
  body: formData
})
.then(response => response.json())
.then(data => console.log(data))
.catch(error => console.error('Error:', error));
```

#### Example Response

```json
{
  ...
}
```

## Error Handling

The API uses standard HTTP status codes to indicate the success or failure of requests.

### Common Error Responses

1. Authentication Errors
   - Status Code: 401 Unauthorized

2. Missing or Invalid parameters
   - Status Code: 400 Bad Request
      - 'Required "file" missing' (parameter not set)
      - 'Required "file" invalid. Must have mimetype "application/pdf".' (file with incorrect mimetype)
      - 'Required "options" missing.' (parameter not set)
      - 'Required "options" invalid. Must be a valid JSON object.' (data are not JSON)
      - 'Required "options" invalid. Must be a JSON object.' (data are JSON but not an object)

3. GenShare processing failed
   - Status Code: 500 Internal Server Error
