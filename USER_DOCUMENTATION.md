# Snapshot API Endpoints Documentation

This document provides detailed information about the available endpoints in the [Snapshot API](https://snapshot.dataseer.ai) (hosted on [snapshot.dataseer.ai](https://snapshot.dataseer.ai)), along with examples of how to interact with them.

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

| Field    | Type   | Description                                                                                         |
|----------|--------|-----------------------------------------------------------------------------------------------------|
| file     | File   | The PDF file to be processed (required)                                                             |
| options  | String | JSON string of processing options (required) which is a dictionary with optional and required items |

The `options` parameter must contain one mandatory field: 
- `document_type` (required): specify the type of the document sent (see example below), the accepted values are `article`, `research-article`, `research_article`, `original-article`, `original_article`. Invalid values will be rejected by the API with error code 400. 
- `article_id` (required): specify the article ID of the document sent, the API will return 400 if the ID is empty or null

#### Example Request

Using curl:

```bash
curl -X POST -H "Authorization: Bearer <your_token>" \
     -F "file=@path/to/your/file.pdf" \
     -F 'options={"document_type": "article"}' \
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
    "response": [
        {
            "name": "article_id",
            "description": "Article ID",
            "value": "s41523-023-00574-7"
        },
        {
            "name": "das",
            "description": "Data availability statement",
            "value": ""Data are available upon reasonable request. Access to datasets from the Cleveland Clinic and the University Hospitals Cleveland Medical Center (used with permission for this study) should be requested directly from these institutions via their data access request forms. Subject to the institutional review boards’ ethical approval, unidentified data would be made available as a test subset. All experiments and implementation details are described thoroughly in the Materials and methods section so they can be independently replicated with non-proprietary libraries.
Details and codes for feature extraction, feature selection and statistical analysis are available at https://github.com/Hadi-Khorrami.""
        },
        {
            "name": "data_avail_req",
            "description": "Are any data available on request?",
            "value": "Yes"
        },
        {
            "name": "das_share_si",
            "description": "Does the DAS say that the data are shared in the 'Supplementary material' section?",
            "value": "No"
        },
        {
            "name": "data_generalist",
            "description": "Are any data shared on a generalist repository?",
            "value": "No"
        },
        {
            "name": "warrant_generalist",
            "description": "URL(s) and PID(s) for any generalist repositories",
            "value": []
        },
        {
            "name": "data_specialist",
            "description": "Are any data shared on a specialist repository?",
            "value": "No"
        },
        {
            "name": "warrant_specialist",
            "description": "URL(s) and PID(s) for any specialist repositories",
            "value": []
        },
        {
            "name": "non-functional_urls",
            "description": "List of Non-functional repository URLs",
            "value": []
        },
        {
            "name": "computer_gen",
            "description": "Was any shareable computer code generated?",
            "value": "Yes"
        },
        {
            "name": "computer_si",
            "description": "Is any computer code shared as Supplemental Material?",
            "value": "No"
        },
        {
            "name": "computer_online",
            "description": "Is any computer code shared online?",
            "value": "Yes"
        },
        {
            "name": "warrants_code_online",
            "description": "URL(s) and PID(s) for any online code sharing locations",
            "value": ["https://github.com/Hadi-Khorrami"]
        }
    ]
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
