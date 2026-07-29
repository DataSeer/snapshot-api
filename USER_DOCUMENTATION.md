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

| Endpoint                 | Method | Content-Type          | Description                                                   |
|--------------------------|--------|-----------------------|---------------------------------------------------------------|
| `/`                      | GET    | N/A                   | Return information about available API routes.                |
| `/processPDF`            | POST   | `multipart/form-data` | Process a PDF document (sync, backward compatible)            |
| `/processPDF/sync`       | POST   | `multipart/form-data` | Process a PDF document synchronously                          |
| `/processPDF/async`      | POST   | `multipart/form-data` | Process a PDF document asynchronously with callback           |
| `/jobs/:requestId`       | GET    | N/A                   | Get job status for async processing                           |
| `/requests/:requestId`   | GET    | N/A                   | Get the record of a single request (made using my token)      |
| `/requests/:requestId`   | DELETE | N/A                   | Delete a request (made with my token) and all associated data |

Access to each endpoint is granted per API token — a token that is not allow-listed for a route
receives `403`. Ask DataSeer support which routes your token covers.

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

#### Required

- `article_id` (required): specify the article ID of the document sent. The request is rejected with
  `400` if the ID is empty or null.
- `document_type` (required): specify the type of the document sent. The accepted values are
  `article`, `research-article`, `research_article`, `original-article`, `original_article`,
  `Original Article`, `Original Study`, `Research Article`. Invalid values are rejected with `400`.

#### Analysis inputs

- `das` (optional): specify the DAS of the document sent. If provided, the value will be stored in
  `das_custom_ms` and `das_custom_presence_ms` will be set to `true`. If not provided, `N/A` will be
  stored in `das_custom_ms` and `das_custom_presence_ms` will be set to `false`.
- `editorial_policy` (optional): specify the editorial policy requested for this document (e.g.
  `TFOD`, `SURR`, `PLOS`, `AUTH`, `JID`). The values available to you are attached to your API key;
  an unavailable or missing value is silently replaced by your key's default. The policy actually
  applied is echoed back in the `editorial_policy` response field, and it determines which
  policy-dependent fields you receive (see
  [Policy-dependent fields](#policy-dependent-fields)).

#### Echoed metadata

These are stored, logged and returned unchanged. They do not influence the analysis.

- `journal_name` (optional): name of the journal. `N/A` when not provided.
- `submission_number` (optional): an identifier of the submission.
- `filename` (optional): the name of the file.
- `article_title` (optional): title of the article.
- `subject_area` (optional): subject area — an array of strings. Returned as the string `"N/A"` when
  not provided.
- `abstract` (optional): abstract of the article.

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

#### Identity and echoed metadata

| name | description | value | comments |
| --- | --- | --- | --- |
| report_link | Report link | String | URL to the report page. Added by snapshot-api; absent if report creation was skipped or failed. |
| article_id | Article ID | String | An identifier for the document |
| filename | The name of the file | String | The name of the file |
| submission_number | An identifier of the submission from Editorial Manager or ScholarOne | String | `"N/A"` when not supplied |
| article_title | Title of the article | String | `"N/A"` when not supplied |
| subject_area | Subject area | Array\<String\> \| String | The classification selected by the author. The string `"N/A"` when not supplied. |
| abstract | Abstract of the article | String | `"N/A"` when not supplied |
| journal_name | The name of the journal | String | `"N/A"` when not supplied |
| editorial_policy | Editorial policy to use | String | The policy **actually applied** — not necessarily the one requested |

#### Data Availability Statement

| name | description | value | comments |
| --- | --- | --- | --- |
| das_original_ms | Data Availability Statement in the manuscript | String | The DAS text extracted from the PDF. `"N/A"` when none found. |
| das_original_presence_ms | Have the authors provided a Data Availability Statement (DAS) in the manuscript? | Boolean | Derived from `das_original_ms` |
| das_custom_ms | Data Availability Statement provided in the metadata of Editorial Manager or ScholarOne? | String | The DAS you passed in `options.das`. `"N/A"` when not supplied. |
| das_custom_presence_ms | Is there a Data Availability Statement provided in the metadata of Editorial Manager or ScholarOne? | Boolean | Whether `options.das` was supplied |

#### Where the data are

| name | description | value | comments |
| --- | --- | --- | --- |
| data_on_request | Are any data available on request? | Boolean | Does the article indicate that data is available on request? |
| data_in_manuscript | Does the article indicate that data is available inside the manuscript? | Boolean | |
| das_in_si | Does the DAS say that the data are shared in the 'Supplementary material' section? | Boolean | **Distinct from `data_in_si`** — this one is about what the DAS *states*. |
| data_in_si | Does the article indicate that data is available in one of the supplemental files? | Boolean | **Distinct from `das_in_si`** — this one is about the article as a whole. |
| data_in_ms_or_si | Is the DAS stating that 'All data are in the manuscript and/or supporting information files? | Boolean | Computed as `data_in_manuscript OR data_in_si` |
| data_in_repository | Does the article indicate that data is stored in an online repository? | Boolean | |
| data_not_generated | Does the article indicate that data sharing does not apply? | Boolean | `true` means the study did not generate data |
| claims_no_data_shared | Claims no data shared | Boolean | |
| data_generalist | Are any data shared on a generalist repository? | Boolean | e.g. Zenodo, figshare, Dryad |
| warrant_generalist | URL(s) and PID(s) for any generalist repositories | Array\<String\> | Evidence backing `data_generalist` |
| data_specialist | Are any data shared on a specialist repository? | Boolean | e.g. GEO, PDB, GenBank |
| warrant_specialist | URL(s) and PID(s) for any specialist repositories | Array\<String\> | Evidence backing `data_specialist` |
| is_dryad | If there is a repository found in the manuscript text, is it Dryad? | Boolean \| `"N/A"` | Returns the string `"N/A"` when no repository was found |
| data_on_community_repo | True if TFOD node 18 is answered Yes; False if node 18 is answered No; NA if node 18 is not reached | Boolean \| `"NA"` | TFOD policy only |

#### Exemption claims

| name | description | value | comments |
| --- | --- | --- | --- |
| exemption_requested | Do the authors claim an exemption from sharing their data on a repository? | Boolean | Did the authors request an exemption from data sharing? |
| exemption_sensitive_ethics_protection | Do the authors claim an exemption because their data are too sensitive to share OR it would unethical to share them OR covered by a data protection agreement? | Boolean | Data too sensitive, ethical concerns, or data privacy/protection issues |
| exemption_large | Do the authors claim an exemption because their dataset is too large to fit onto a suitable repository? | Boolean | |
| exemption_no_suitable_repository | Do the authors claim an exemption because there is no suitable repository for their dataset? | Boolean | |
| exemption_third_party | Do the authors claim an exemption because a third party controls access to their dataset? | Boolean | Data owned or held by a third party |
| exemption_reasons | List of the reasons did authors gave for their exemption claim. | Array\<String\> | |

#### Links, DOIs and identifiers found in the DAS

| name | description | value | comments |
| --- | --- | --- | --- |
| data_url | Does the DAS contains one or more URLs? | Boolean | |
| das_urls | List of all URLs found in the DAS | Array\<String\> | Plain URL strings |
| das_urls_details | List of all URLs found in the DAS | Array\<Object\> | Each entry carries `url` (string), `valid` (boolean) and `is_landing_page` (boolean). **This is the field report templates read** — note the plural `urls`. |
| das_dois | List of all DOIs found in the DAS | Array\<String\> | |
| non-functional_urls | List of Non-functional repository URLs | Array\<String\> | Note the hyphen in the name |
| data_in_reference | Mapping of Data Availability URLs to whether they are also cited in References | Dictionary\<String, Boolean\> | |
| das_url | True if there are one or more URLs with section=Data Availability; False if DAS present but no URLs; NA if DAS absent | Boolean \| `"NA"` | Singular — distinct from `das_urls` and from `data_url` |
| das_doi | True if there are one or more DOIs with section=Data Availability; False if DAS present but no DOIs; NA if DAS absent | Boolean \| `"NA"` | Singular — distinct from `das_dois` |
| das_data_url | True if there is a valid Data Availability URL with established_data_repository=True; False if DAS present but none; NA if DAS absent | Boolean \| `"NA"` | |
| das_data_doi | True if there is a valid DOI in Additional Information; False if DAS present but none; NA if DAS absent | Boolean \| `"NA"` | |
| das_data_url_doi | True if either das_data_url or das_data_doi is True; NA if DAS absent | Boolean \| `"NA"` | |
| accepted_PID | True if the DAS contains a DOI/URL PID or accession-like persistent identifier | Boolean | |

#### Licences

| name | description | value | comments |
| --- | --- | --- | --- |
| dataset_licenses | Acceptable dataset licenses only, e.g. CC0 or CC-BY | Dictionary\<String, Array\<String\>\> | Repository/database → normalised licence names |
| unacceptable_dataset_licences | Dataset licenses that are not acceptable | Array | Note the British spelling — this is intentional |

> `accepted_license` was replaced by the two fields above in June 2026. It still appears in archived
> responses produced before that change.

#### Code sharing

| name | description | value | comments |
| --- | --- | --- | --- |
| computer_gen | Was shareable computer code generated? | Boolean \| String | Has been observed returning the string `"Yes"` |
| computer_si | Is any computer code shared as Supplemental Material? | Boolean | |
| computer_online | Is any computer code shared online? | Boolean | |
| warrants_code_online | URL(s) and PID(s) for any online code sharing locations | Array\<String\> | Note the plural `warrants_` prefix |

#### Narrative output and score

| name | description | value | comments |
| --- | --- | --- | --- |
| action_required | Action required after the analysis of manuscript | String \| Array\<String\> | A list of short statements explaining what action is **required** from the authors to comply with the policy. Empty (or containing "Pass Checks") means compliant. Requirements only — never recommendations. |
| action_recommended | Action recommended after the analysis of manuscript | String \| Array\<String\> | A list of short statements explaining what action is **recommended**. Recommendations only — never requirements. |
| reasoning_summary | A summary paragraph explaining the decisions for the above fields | String | Markdown |
| reasoning | Detailed explanation of your reasoning for the answers. | String | Long-form; often `"N/A"` |
| reasoning_summary_authors | A summary paragraph explaining the decisions for the above fields for authors | String | Author-facing wording |
| reasoning_summary_email | Email to send based on reasonings summaries | String | Drives the "draft email to authors" block in reports |
| si_summary | A summary of SI files | String | Markdown |
| cumulated_score | Cumulated score from snapshot | Integer | Between −10 and 32 |

#### Policy-dependent fields

Returned **only when the applied `editorial_policy` enables them**:

| name | description | value | enabled for |
| --- | --- | --- | --- |
| funding_statement | Funding statement extracted from the manuscript | String | `AUTH`, `TFOD`, `PLOS`, `JID`, `SURR`. `"N/A"` when the section is absent. |
| suggested_das | Suggested Data Availability Statement generated for AUTH policy based on graph traversal output | String | `AUTH` only |
| suggested_das_reasoning | Reasoning for the suggested AUTH Data Availability Statement | String | `AUTH` only |


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
      "name": "das_urls_details",
      "description": "List of all URLs found in the DAS",
      "value": [
        {
          "url": "...",
          "valid": true || false,
          "is_landing_page": true || false,
        }
      ]
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
      "name": "claims_no_data_shared",
      "description": "Claims no data shared",
      "value": true || false || "N/A"
    },
    {
      "name": "data_in_reference",
      "description": "Mapping of Data Availability URLs to whether they are also cited in References",
      "value": {
        "link": false || true, 
        "..." : false || true
      }
    },
    {
      "name": "dataset_licenses",
      "description": "Acceptable dataset licenses only, e.g. CC0 or CC-BY",
      "value": {
        "data repository": ["license name"],
        "...":["..."]
      }
    },
    {
      "name": "unacceptable_dataset_licences",
      "description": "Dataset licenses that are not acceptable",
      "value": ["..."]
    },
    {
      "name": "report_link",
      "description": "Report link",
      "value": "https://snapshot-reports.dataseer.ai/r/..."
    }
  ]
}
```

> This example lists the fields a key with no field restrictions receives. The set of fields
> delivered to your key — and, for some integrations, their order — is configured per key. If a field
> documented above is missing from your responses, contact DataSeer support (support@dataseer.ai) to
> have it enabled for your key.

### Process PDF Async (POST)

The `/processPDF/async` endpoint processes PDFs in the background and sends the result to a callback URL when complete.

#### Request Parameters

| Field              | Type   | Description                                                    |
|--------------------|--------|----------------------------------------------------------------|
| file               | File   | (required) The PDF file to be processed                        |
| supplementary_file | File   | (optional) ZIP file containing supplementary materials         |
| notification_url   | String | (required) URL to POST results to when processing completes    |
| options            | String | (required) **JSON string** of processing options               |

The `options` parameter is the same as for `/processPDF` (see above).

#### Example Request

```bash
curl -X POST -H "Authorization: Bearer <your_token>" \
     -F "file=@path/to/your/file.pdf" \
     -F "notification_url=https://your-server.com/callback" \
     -F 'options={"article_id": "KWG1234", "document_type": "article"}' \
     https://snapshot.dataseer.ai/processPDF/async
```

#### Example Response

```json
{
  "status": "processing",
  "request_id": "12345678901234567890123456789012"
}
```

#### Callback Notification

When processing completes, the API POSTs to the `notification_url`:

**On success:**
```json
{
  "status": "completed",
  "request_id": "12345678901234567890123456789012",
  "response": {
    "status": 200,
    "data": [ ... full response array ... ]
  }
}
```

**On failure:**
```json
{
  "status": "failed",
  "request_id": "12345678901234567890123456789012",
  "error": "Error message describing the failure"
}
```

### Get Job Status (GET)

Check the status of an async processing job.

#### Example Request

```bash
curl -H "Authorization: Bearer <your_token>" \
     https://snapshot.dataseer.ai/jobs/12345678901234567890123456789012
```

#### Example Responses

**Job in progress:**
```json
{
  "request_id": "12345678901234567890123456789012",
  "status": "processing",
  "created_at": "2025-01-01T10:00:00.000Z",
  "updated_at": "2025-01-01T10:01:00.000Z",
  "retries": 0,
  "max_retries": 3
}
```

**Job completed:**
```json
{
  "request_id": "12345678901234567890123456789012",
  "status": "completed",
  "created_at": "2025-01-01T10:00:00.000Z",
  "updated_at": "2025-01-01T10:05:00.000Z",
  "retries": 0,
  "max_retries": 3,
  "results": {
    "status": 200,
    "data": [ ... ]
  }
}
```

**Job failed:**
```json
{
  "request_id": "12345678901234567890123456789012",
  "status": "failed",
  "created_at": "2025-01-01T10:00:00.000Z",
  "updated_at": "2025-01-01T10:05:00.000Z",
  "retries": 3,
  "max_retries": 3,
  "error_message": "Error description"
}
```

#### Job Status Values

| Status      | Description                                      |
|-------------|--------------------------------------------------|
| pending     | Job is queued waiting for processing             |
| processing  | Job is currently being processed                 |
| completed   | Job finished successfully                        |
| failed      | Job failed permanently after all retries         |
| retrying    | Job failed but will be retried automatically     |

### Delete Request (DELETE)

Delete a request and all associated data (S3 objects + database records).

**Authorization:** Users can delete their own requests. Admin users can delete any user's requests.

#### Example Request

```bash
curl -X DELETE -H "Authorization: Bearer <your_token>" \
     https://snapshot.dataseer.ai/requests/12345678901234567890123456789012
```

#### Example Response

```json
{
  "message": "Request deleted",
  "request_id": "12345678901234567890123456789012",
  "details": {
    "request_id": "12345678901234567890123456789012",
    "user_name": "your_user_id",
    "s3_objects_deleted": 15,
    "db_requests_deleted": 1,
    "db_jobs_deleted": 1
  }
}
```

#### Error Responses

| Error code | Description                                              |
|------------|----------------------------------------------------------|
| 400        | Invalid request ID format (must be 32 hex characters)    |
| 403        | Not authorized to delete this request                    |
| 404        | Request not found                                        |

## Error Handling

The API uses standard HTTP status codes to indicate the success or failure of requests.

### Transport-level errors

| Error code | Meaning | What to do |
|---|---|---|
| 401 | Missing, malformed or expired `Authorization` header | Check the `Bearer <token>` header. Temporary tokens expire — request a new one. |
| 403 | Your token is not allow-listed for this route | Contact DataSeer support to have the route added to your key. |
| 429 | Rate limit exceeded for your token | Back off and retry. Limits are per token and configurable — contact support if yours is too low. |
| 502 / 503 | A downstream service (GenShare, GROBID) is unavailable | Retry later. `GET /ping` reports which service is down. |
| 500 | Unexpected server error | Report the `request_id` to DataSeer support — the full processing log is archived under it. |

### Request-validation errors

Content validation of the PDF and of `options` is performed by the analysis engine, so these
messages are produced downstream and passed through by the API with status `400`. The only
validation performed by the API itself is the supplementary-file format check.

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
