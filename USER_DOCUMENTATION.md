# Snapshot API Endpoints Documentation

## Table of content

+ [Introduction](#introduction)
+ [Authentication](#authentication)
+ [API Endpoints](#api-endpoints)
+ [Error handling](#error-handling)

## Introduction

This document provides detailed information about the available endpoints in
the [Snapshot API](https://snapshot.dataseer.ai) (hosted on [snapshot.dataseer.ai](https://snapshot.dataseer.ai)).
The API expects to receive one PDF document for each request, along with optional supplementary files, required parameters and an authentication
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

| Field                | Type   | Description                                                                                             |
|----------------------|--------|---------------------------------------------------------------------------------------------------------|
| file                 | File   | (required) The PDF file to be processed                                                                 |
| supplementary_file   | File   | (optional) ZIP file containing supplementary materials                                                  |
| options              | String | (required) **JSON string** of processing options which is a dictionary with optional and required items |

The `options` parameter is a JSON object with following properties:

- `document_type` (required): specify the type of the document sent (see example below), the accepted values are
  `article`, `research-article`, `research_article`, `original-article`, `original_article`. Invalid values will be
  rejected by the API with error code 400.
- `article_id` (required): specify the article ID of the document sent, the API will return 400 if the ID is empty or
  null
- `das` (optional): specify the DAS of the document sent. If provided, the value will be stored in `das_custom_ms` & `das_custom_presence_ms` will be set to `true`. If not provided, `N/A` will be stored in `das_custom_ms` & `das_custom_presence_ms` will be set to `false`.
- `journal_name` (optional): specify the name of the journal. If not provided, `N/A` will be stored in `journal_name`.
- `editorial_policy` (optional): specify the editorial policy requested for this document (e.g. `TFOD`, `SURR`, `PLOS`). A list of available values will be attached to your API key, and a default value will be assigned in case of error (or absence).
- `submission_number` (optional): An identifier of the submission. Will be returned as is.
- `filename` (optional): The name of the file. Will be returned as is.
- `article_title` (optional): Title of the article. Will be returned as is.
- `subject_area` (optional): Subject area. Will be returned as is.
- `abstract` (optional): Abstract of the article. Will be returned as is.

```json
{
     "article_id": "KWG1234",
     "document_type": "article",
     "das": "The DAS content of my article",
     "journal_name": "My Journal",
     "editorial_policy": "TFOD",
     "submission_number": "...",
     "filename": "article.pdf",
     "article_title": "...",
     "subject_area": ["subject_area1", "subject_area2"],
     "abstract": "..."
}
```

#### Supplementary Files

The `supplementary_file` parameter is optional and must be a ZIP file containing any supplementary materials related to the manuscript. When provided:

- The file must be in ZIP format (`.zip` extension or `application/zip` MIME type)
- The ZIP file will be forwarded to the GenShare service for analysis alongside the main PDF
- Non-ZIP files will be rejected with a 400 error
- The supplementary files are stored in AWS S3 for complete request traceability

#### Example Request

Using curl with main PDF only:

```bash
curl -X POST -H "Authorization: Bearer <your_token>" \
     -F "file=@path/to/your/file.pdf" \
     -F 'options={"article_id": "KWG1234", "document_type": "article", "journal_name": "My Journal", "editorial_policy": "TFOD"}' \
     https://snapshot.dataseer.ai/processPDF
```

Using curl with PDF and supplementary files:

```bash
curl -X POST -H "Authorization: Bearer <your_token>" \
     -F "file=@path/to/your/file.pdf" \
     -F "supplementary_file=@path/to/supplementary.zip" \
     -F 'options={"article_id": "KWG1234", "document_type": "article", "journal_name": "My Journal", "editorial_policy": "TFOD"}' \
     https://snapshot.dataseer.ai/processPDF
```

Using JavaScript (with fetch):

```javascript
const formData = new FormData();
formData.append('file', fileInput.files[0]); // Main PDF file
if (supplementaryInput.files[0]) {
    formData.append('supplementary_file', supplementaryInput.files[0]); // Optional ZIP file
}
formData.append('options', JSON.stringify({
    "article_id": "KWG1234",
    "document_type": "article"
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

Here is an example of JSON data returned by the API.
The 'response' key is an array of objects. Each item is structured as follows:
  - `name`: the name of the data (ex: das, non-functional_urls, cumulated_score)
  - `description`: the description of the data (ex: "Data availability statement" for "das")
  - `value`: the value of the data

***Note: the value of `cumulated_score` is between -10 and 32***

Here is the list of all available fields

| name | description | value | comments |
| --- | --- | --- | --- |
| report_link | Report link | String | URL to the report page |
| article_id | Article ID | String | An identifier for the document |
| filename | The name of the file | String | The name of the file |
| submission_number | An identifier of the submission from Editorial Manager or ScholarOne | String | An identifier for the submission |
| article_title | Title of the article | String | Title of the article as provided by the authors |
| subject_area | Subject area | Array<String> | The classification selected by the author |
| abstract | Abstract of the article | String | Abstract as it entered by the author |
| editorial_policy | Editorial policy to use | String | The policy to specify used in the process |
| das_custom_ms | Data availability in the metadata | String | Custom Data Availability Statement (to replace the DAS from the PDF) |
| das_custom_presence_ms | Is there a DAS in the metadata? | Boolean | Is there a custom DAS provided? |
| das_original_ms | Data Availability Statement in the manuscript | String | Data Availability Statement in the manuscript |
| das_original_presence_ms | Have the authors provided a Data Availability Statement (DAS) in the manuscript? | Boolean | Have the authors provided a Data Availability Statement (DAS) in the manuscript? |
| data_on_request | Are any data available on request? | Boolean | Does the article indicate that data is available on request? |
| data_in_manuscript | Does the article indicate that data is available inside the manuscript? | Boolean | Does the article indicate that data is available inside the manuscript? |
| data_in_si | Does the DAS say that the data are shared in the 'Supplementary material' section? | Boolean | Does the DAS say that the data are shared in the 'Supplementary material' section? |
| data_in_repository | Does the article indicate that data is stored in an online repository? | Boolean | Does the article indicate that data is stored in an online repository? |
| data_not_generated | Does the article indicate that data sharing does not apply? | Boolean | Does the article say that data sharing does not apply? ("yes" means the study did not generate data) |
| exemption_requested | Do the authors claim an exemption from sharing their data on a repository? | Boolean | Did the authors request an exemption from data sharing? |
| exemption_sensitive_ethics_protection | Do the authors claim an exemption because their data are too sensitive to share OR it would unethical to share them OR covered by a data protection agreement? | Boolean | Did the authors request an exemption for any of the following reasons: data too sensitive, ethical concerns, or data privacy/protection issues? |
| exemption_large | Do the authors claim an exemption because their dataset is too large to fit onto a suitable repository? | Boolean | Did the authors request an exemption because the data is too large to share? |
| exemption_no_suitable_repository | Do the authors claim an exemption because there is no suitable repository for their dataset? | Boolean | Did the authors request an exemption because there is no suitable repository for the data? |
| exemption_third_party | Do the authors claim an exemption because a third party controls access to their dataset? | Boolean | Did the authors request an exemption because the data is owned or held by a third party? |
| exemption_reasons | List of the reasons did authors gave for their exemption claim. | Array<String> | List of the reasons did authors gave for their exemption claim. |
| das_exemption_reasons | List of the reasons did authors gave for their exemption claim. | Array<String> | List of the reasons did authors gave for their exemption claim. |
| action_required | Action required after the analysis of manuscript | String | If the user has provided a data sharing policy, it will have a list of requirements (separate from the recommendations): a list of short statements explaining what action is **required** from the authors to comply with the policy. If no action is required, the list will be empty. This field is only for the "Requirements", not the "Recommendations". |
| action_recommended | Action recommended after the analysis of manuscript | String | If the user has provided a data sharing policy, it will have a list of recommendations (separate from the requirements): a list of short statements explaining what action is **recommended** from the authors to comply with the policy. If no action is recommended, the list will be empty. This field is only for the "Recommendations", not the "Requirements". |
| reasoning_summary | A summary paragraph explaining the decisions for the above fields | String | A summary paragraph explaining the decisions for the above fields |
| reasoning | Detailed explanation of your reasoning for the answers. | String | Detailed explanation of your reasoning for the answers. |
| data_generalist | Are any data shared on a generalist repository? | Boolean | Are any data shared on a generalist repository? |
| warrant_generalist | URL(s) and PID(s) for any generalist repositories | Array<String> | URL(s) and PID(s) for any generalist repositories |
| data_specialist | Are any data shared on a specialist repository? | Boolean | URL(s) and PID(s) for any generalist repositories found in either the DAS or full text |
| warrant_specialist | URL(s) and PID(s) for any specialist repositories | Array<String> | URL(s) and PID(s) for any specialist repositories |
| data_url | Does the DAS contains one or more URLs? | Boolean | Does the DAS contain a URL? |
| is_dryad | List of Non-functional repository URLs | Boolean | If there is a repository found in the manuscript text, is it Dryad? |
| non-functional_urls | List of non functional URLs found in the DAS | Array<String> | List of non functional URLs found in the DAS |
| das_urls | List of all URLs found in the DAS | Array<Object> | Each URL has two properties: “url” (string), “valid” (boolean) & "is_landing_page" (boolean) |
| das_dois | List of all DOIs found in the DAS | Array<String> | List of all DOIs found in the DAS |
| data_on_accept | Does the DAS state that the data will be made available upon acceptance/publication? | Boolean | Does the DAS state that the data will be made available upon acceptance/publication? |
| computer_gen | Was shareable computer code generated? | Boolean | Was shareable computer code generated? |
| computer_si | Is any computer code shared as Supplemental Material? | Boolean | Is any computer code shared as Supplemental Material? |
| computer_online | Is any computer code shared online? | Boolean | Is any computer code shared online? |
| data_in_ms_or_si | Is the DAS stating that 'All data are in the manuscript and/or supporting information files? | Boolean | Is the DAS stating that 'All data are in the manuscript and/or supporting information files? |
| data_share_si | Check for the minimal dataset in the Supporting Information files. | Boolean | Check for the minimal dataset in the Supporting Information files. |
| cumulated_score | Cumulated score from snapshot | Integer | Cumulated score from snapshot |
| warrants_code_online | URL(s) and PID(s) for any online code sharing locations | Array<String> | URL(s) and PID(s) for any online code sharing locations |
| warrants_code_online | URL(s) and PID(s) for any online code sharing locations | Array<String> | URL(s) and PID(s) for any online code sharing locations |
| claims_no_data_shared | Claims no data shared | Boolean | Claims no data shared |

```json
{
  "response": [
    {
      "name": "article_id",
      "description": "Article ID",
      "value": "..."
    },
    {
      "name": "submission_number",
      "description": "An identifier of the submission from Editorial Manager or ScholarOne",
      "value": "..."
    },
    {
      "name": "filename",
      "description": "The name of the file",
      "value": "..."
    },
    {
      "name": "article_title",
      "description": "Title of the article",
      "value": "..."
    },
    {
      "name": "subject_area",
      "description": "Subject area",
      "value": "..."
    },
    {
      "name": "abstract",
      "description": "Abstract of the article",
      "value": "..."
    },
    {
      "name": "journal_name",
      "description": "The name of the journal",
      "value": "..."
    },
    {
      "name": "editorial_policy",
      "description": "Editorial policy to use",
      "value": "..."
    },
    {
      "name": "das_custom_ms",
      "description": "Data Availability Statement provided in the metadata of Editorial Manager or ScholarOne?",
      "value": "..."
    },
    {
      "name": "das_custom_presence_ms",
      "description": "Is there a Data Availability Statement provided in the metadata of Editorial Manager or ScholarOne?",
      "value": true || false || "N/A"
    },
    {
      "name": "das_original_ms",
      "description": "Data Availability Statement in the manuscript",
      "value": "..."
    },
    {
      "name": "das_original_presence_ms",
      "description": "Have the authors provided a Data Availability Statement (DAS) in the manuscript?",
      "value": true || false || "N/A"
    },
    {
      "name": "data_on_request",
      "description": "Are any data available on request?",
      "value": true || false || "N/A"
    },
    {
      "name": "data_in_manuscript",
      "description": "Does the article indicate that data is available inside the manuscript?",
      "value": true || false || "N/A"
    },
    {
      "name": "data_in_si",
      "description": "Does the DAS say that the data are shared in the 'Supplementary material' section?",
      "value": true || false || "N/A"
    },
    {
      "name": "data_not_generated",
      "description": "Does the article indicate that data sharing does not apply?",
      "value": true || false || "N/A"
    },
    {
      "name": "exemption_requested",
      "description": "Do the authors claim an exemption from sharing their data on a repository?",
      "value": true || false || "N/A"
    },
    {
      "name": "exemption_sensitive_ethics_protection",
      "description": "Do the authors claim an exemption because their data are too sensitive to share OR it would unethical to share them OR covered by a data protection agreement?",
      "value": true || false || "N/A"
    },
    {
      "name": "exemption_large",
      "description": "Do the authors claim an exemption because their dataset is too large to fit onto a suitable repository?",
      "value": true || false || "N/A"
    },
    {
      "name": "exemption_no_suitable_repository",
      "description": "Do the authors claim an exemption because there is no suitable repository for their dataset?",
      "value": true || false || "N/A"
    },
    {
      "name": "exemption_third_party",
      "description": "Do the authors claim an exemption because a third party controls access to their dataset?",
      "value": true || false || "N/A"
    },
    {
      "name": "exemption_reasons",
      "description": "List of the reasons did authors gave for their exemption claim.",
      "value": ["..."]
    },
    {
      "name": "data_in_repository",
      "description": "Does the article indicate that data is stored in an online repository?",
      "value": true || false || "N/A"
    },
    {
      "name": "reasoning_summary",
      "description": "A summary paragraph explaining the decisions for the above fields",
      "value": "..."
    },
    {
      "name": "reasoning",
      "description": "Detailed explanation of your reasoning for the answers.",
      "value": "..."
    },
    {
      "name": "data_generalist",
      "description": "Are any data shared on a generalist repository?",
      "value": true || false || "N/A"
    },
    {
      "name": "warrant_generalist",
      "description": "URL(s) and PID(s) for any generalist repositories",
      "value": ["..."]
    },
    {
      "name": "data_specialist",
      "description": "Are any data shared on a specialist repository?",
      "value": true || false || "N/A"
    },
    {
      "name": "warrant_specialist",
      "description": "URL(s) and PID(s) for any specialist repositories",
      "value": ["..."]
    },
    {
      "name": "data_url",
      "description": "Does the DAS contains one or more URLs?",
      "value": true || false || "N/A"
    },
    {
      "name": "is_dryad",
      "description": "If there is a repository found in the manuscript text, is it Dryad?",
      "value": true || false || "N/A"
    },
    {
      "name": "non-functional_urls",
      "description": "List of Non-functional repository URLs",
      "value": ["..."]
    },
    {
      "name": "das_urls",
      "description": "List of all URLs found in the DAS",
      "value": ["..."]
    },
    {
      "name": "das_dois",
      "description": "List of all DOIs found in the DAS",
      "value": ["..."]
    },
    {
      "name": "computer_gen",
      "description": "Was shareable computer code generated?",
      "value": true || false || "N/A"
    },
    {
      "name": "computer_si",
      "description": "Is any computer code shared as Supplemental Material?",
      "value": true || false || "N/A"
    },
    {
      "name": "computer_online",
      "description": "Is any computer code shared online?",
      "value": true || false || "N/A"
    },
    {
      "name": "warrants_code_online",
      "description": "URL(s) and PID(s) for any online code sharing locations",
      "value": ["..."]
    },
    {
      "name": "cumulated_score",
      "description": "Cumulated score from snapshot",
      "value": 0 // Integer between -10 and 32
    },
    {
      "name": "action_required",
      "description": "Action required after the analysis of manuscript",
      "value": "..."
    },
    {
      "name": "action_recommended",
      "description": "Action recommended after the analysis of manuscript",
      "value": "..."
    },
    {
      "name": "data_in_ms_or_si",
      "description": "Is the DAS stating that 'All data are in the manuscript and/or supporting information files?",
      "value": true || false || "N/A"
    },
    {
      "name": "data_share_si",
      "description": "Check for the minimal dataset in the Supporting Information files. ",
      "value": true || false || "N/A"
    },
    {
      "name": "claims_no_data_shared",
      "description": "Claims no data shared",
      "value": true || false || "N/A"
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
| The supplementary files provided are not in ZIP format                                                                                                 | 400        | Invalid supplementary files format. Only ZIP files are supported.                                                                                                                                                                                                      |
| The request does not contains the `options` parameter                                                                                                  | 400        | No options information received, this is a mandatory parameter that must contain at least 'article_id' and 'document_type'. Check the documentation for more information.                                                                                              |
| The `options` parameter does not contains valid data, or its data is not properly formatted as JSON (e.g. used single quotes instead of double quotes) | 400        | The options parameter was not well formatted. This is a mandatory parameter that should follow the JSON format (e.g. double quotes instead of single quotes) and must contain at least 'article_id' and 'document_type'. Check the documentation for more information. |
| `article_id` is not supplied                                                                                                                           | 400        | Missing article ID. It is a required information to be supplied as field 'article_id' of the parameter 'options'. Check the documentation for more information.                                                                                                        |
| `article_id` is supplied but invalid: empty or null                                                                                                    | 400        | The supplied article ID is empty or null. It is a required information to be supplied as field 'article_id' of the parameter 'options'. Check the documentation for more information.                                                                                  |
| `document_type` is not supplied                                                                                                                        | 400        | Missing document type. It is a required information to be supplied as field 'document_type' of the parameter 'options'. Check the documentation for more information.                                                                                                  |
| `document_type` is supplied but invalid: empty, null or of a non-acceptable type                                                                       | 400        | The supplied document type is empty or null. It is a required information to be supplied as field 'document_type' of the parameter 'options'. Check the documentation for more information.                                                                            |
| `document_type` is supplied but indicate a document that type that is not supported                                                                    | 400        | The SnapShot tool does not support this type of document. Check the documentation for more information.                                                                                                                                                                |
| `supplementary_file` are not well formed JSON                                                                                                         | 400        | The supplementary file list cannot be parsed as a JSON object.                                                                                                                                                                                                         |