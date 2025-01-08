# Snapshot API Endpoints Documentation

## Table of content

+ [Introduction](#introduction)
+ [Authentication](#authentication)
+ [API Endpoints](#api-endpoints)
+ [Error handling](#error-handling)

## Introduction

This document provides detailed information about the available endpoints in
the [Snapshot API](https://snapshot.dataseer.ai) (hosted on [snapshot.dataseer.ai](https://snapshot.dataseer.ai)).
The API expects to receive one PDF document for each request, along with, required parameters and an authentication
token, and it returns a JSON response with the computed OSI scores and other relevant information.

## Authentication

All endpoints require JWT authentication which are based on tokens provided by DataSeer.
The API tokens must be included in each requests `Authorization header`:

```
Authorization: Bearer <your_token>
```

Should you need an API token or have issues with authentication, please contact DataSeer support (support@dataseer.ai). Each API token is
bounded to a specific user.

## API Endpoints

| Endpoint      | Method | Content-Type          | Description                                    |
|---------------|--------|-----------------------|------------------------------------------------|
| `/`           | GET    | N/A                   | Return information about available API routes. |
| `/processPDF` | POST   | `multipart/form-data` | Process a PDF document                         |

### API Information (GET)

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

### Process PDF (POST)

#### Request Parameters

| Field   | Type   | Description                                                                                             |
|---------|--------|---------------------------------------------------------------------------------------------------------|
| file    | File   | The PDF file to be processed (required)                                                                 |
| options | String | **JSON string** of processing options (required) which is a dictionary with optional and required items |

The `options` parameter must contain one mandatory field:

- `document_type` (required): specify the type of the document sent (see example below), the accepted values are
  `article`, `research-article`, `research_article`, `original-article`, `original_article`. Invalid values will be
  rejected by the API with error code 400.
- `article_id` (required): specify the article ID of the document sent, the API will return 400 if the ID is empty or
  null

```json
{
     "article_id": "KWG1234",
     "document_type": "article"
}
```

#### Example Request

Using curl:

```bash
curl -X POST -H "Authorization: Bearer <your_token>" \
     -F "file=@path/to/your/file.pdf" \
     -F 'options={"article_id": "KWG1234", "document_type": "article"}' \
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
      "value": "Data are available upon reasonable request. Access to datasets from the Cleveland Clinic and the University Hospitals Cleveland Medical Center (used with permission for this study) should be requested directly from these institutions via their data access request forms. Subject to the institutional review boards’ ethical approval, unidentified data would be made available as a test subset. All experiments and implementation details are described thoroughly in the Materials and methods section so they can be independently replicated with non-proprietary libraries. Details and codes for feature extraction, feature selection and statistical analysis are available at https://github.com/Hadi-Khorrami."
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
      "value": [
        "https://github.com/Hadi-Khorrami"
      ]
    },
    {
        "name": "cumulated_score",
        "description": "Cumulated score from snapshot",
        "value": 0
    }
  ]
}
```

## Error Handling

The API uses standard HTTP status codes to indicate the success or failure of requests.

| Description                                                                                                                                            | Error code | Message                                                                                                                                                                                                                                                                |
|--------------------------------------------------------------------------------------------------------------------------------------------------------|------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| The PDF document is not supplied                                                                                                                       | 400        | No file received. The Snapshot tools expect PDF documents supplied as 'form-data' with key 'file'. Check the documentation for more information.                                                                                                                       |
| The file provided is not a PDF document                                                                                                                | 400        | Wrong file received. The file must be a PDF document provided as form-data with key 'file'. Check the documentation for more information.                                                                                                                              |
| The request does not contains the `options` parameter                                                                                                  | 400        | No options information received, this is a mandatory parameter that must contain at least 'article_id' and 'document_type'. Check the documentation for more information.                                                                                              |
| The `options` parameter does not contains valid data, or its data is not properly formatted as JSON (e.g. used single quotes instead of double quotes) | 400        | The options parameter was not well formatted. This is a mandatory parameter that should follow the JSON format (e.g. double quotes instead of single quotes) and must contain at least 'article_id' and 'document_type'. Check the documentation for more information. |
| `article_id` is not supplied                                                                                                                           | 400        | Missing article ID. It is a required information to be supplied as field 'article_id' of the parameter 'options'. Check the documentation for more information.                                                                                                        |
| `article_id` is supplied but invalid: empty or null                                                                                                    | 400        | The supplied article ID is empty or null. It is a required information to be supplied as field 'article_id' of the parameter 'options'. Check the documentation for more information.                                                                                  |
| `document_type` is not supplied                                                                                                                        | 400        | Missing document type. It is a required information to be supplied as field 'document_type' of the parameter 'options'. Check the documentation for more information.                                                                                                  |
| `document_type` is supplied but invalid: empty, null or of a non-acceptable type                                                                       | 400        | The supplied document type is empty or null. It is a required information to be supplied as field 'document_type' of the parameter 'options'. Check the documentation for more information.                                                                            |
| `document_type` is supplied but indicate a document that type that is not supported                                                                    | 400        | The SnapShot tool does not support this type of document. Check the documentation for more information.                                                                                                                                                                |
| `supplementary_files` are not well formed JSON                                                                                                         | 400        | The supplementary file list cannot be parsed as a JSON object.                                                                                                                                                                                                         |

