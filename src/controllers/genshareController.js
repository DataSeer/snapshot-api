// File: src/controllers/genshareController.js
const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');
const config = require('../config');
const { ProcessingSession } = require('../utils/s3Storage');
const { appendToSheet, convertToGoogleSheetsDate } = require('../utils/googleSheets');

const genshareConfig = require(config.genshareConfigPath);
const processPDFConfig = genshareConfig.processPDF;
const healthConfig = genshareConfig.health;

const getPath = (path = []) => {
  let defaultResult = ["","","","","","","","","","","","","","","","","","","","","","",""];
  if (!Array.isArray(path) || path.length !== 2) return defaultResult;
  let data = path[1];
  let result = data.split(',');
  // Score is stored at the end of the result
  result[result.length - 1] = parseInt(result[result.length - 1]);
  if (isNaN(result[result.length - 1])) return defaultResult;
  // Do no keep the n-1 & n-2 element
  result.splice(-3, 2);
  return result;
};

const getResponse = (response = []) => {
  let defaultResult = ["","","","","","","","","","","","",""];
  const mapping = {
    "article_id": 0,
    "das": 1,
    "data_avail_req": 2,
    "das_share_si": 3,
    "data_generalist": 4,
    "warrant_generalist": 5,
    "data_specialist": 6,
    "warrant_specialist": 7,
    "non": 8,
    "computer_gen": 9,
    "computer_si": 10,
    "computer_online": 11,
    "warrants_code_online": 12
  }
  if (!Array.isArray(response)) return defaultResult;
  let result = [].concat(defaultResult);
  for (let i = 0; i < response.length; i++) {
    let item = response[i];
    let index;
    if (item && item.name) index = mapping[item.name];
    if (typeof index === "number") {
      // item.value can be an Array, Google Sheets require string
      if (Array.isArray(item.value)) result[index] = item.value.join("\n");
      else result[index] = item.value.toString();
    }
  }
  return result;
};


const appendToSummary = async ({ session, errorStatus, req }) => {
    try {
      // Safely get the filename, defaulting to "No file" if not available
      const filename = req.file?.originalname || "N/A";
      // Get the response info
      let response = getResponse(session.response?.data?.response);
      // Get the Path info
      let path = getPath(session.response?.data?.path);
      // Log to Google Sheets
      await appendToSheet([
        `=HYPERLINK("${session.url}","${session.requestId}")`, // Query ID with S3 link
        errorStatus,                                           // Error status
        convertToGoogleSheetsDate(new Date()),                 // Date
        req.user.id,                                           // User ID
        filename                                               // PDF filename or "No file"
      ].concat(response).concat(path));
      session.addLog('Logged to Google Sheets successfully');
    } catch (sheetsError) {
      session.addLog(`Error logging to Google Sheets: ${sheetsError.message}`);
      console.error('Error logging to Google Sheets:', sheetsError);
    }
};

exports.getGenShareHealth = async (req, res) => {
  try {
    const response = await axios({
      method: healthConfig.method,
      url: healthConfig.url,
      headers: {
        'Content-Type': 'application/json'
      }
    });
    // Forward the status code
    res.status(response.status);
    // Forward the headers
    Object.entries(response.headers).forEach(([key, value]) => {
      res.set(key, value);
    });
    // Send the response data
    res.send(response.data);
  } catch (error) {
    // Forward error response if available
    if (error.response) return res.status(error.response.status).send(error.message);
    return res.status(500).send('GenShare health check failed');
  }
};

exports.processPDF = async (req, res) => {
  // Initialize processing session
  const session = new ProcessingSession(req.user.id, req.file);
  let errorStatus = "No"; // Initialize error status
  
  try {
    // Input validation
    if (!req.file) {
      errorStatus = 'Input request error: Required "file" missing';
      session.addLog('Error: Required "file" missing');
      await session.saveToS3();
      await appendToSummary({ session, errorStatus, req });
      return res.status(400).send('Required "file" missing.');
    }

    if (req.file.mimetype !== "application/pdf") {
      errorStatus = 'Input request error: Invalid file type';
      session.addLog('Error: Invalid file type ' + req.file.mimetype);
      await session.saveToS3();
      await appendToSummary({ session, errorStatus, req });
      return res.status(400).send('Required "file" invalid. Must have mimetype "application/pdf"');
    }

    let options;
    try {
      options = JSON.parse(req.body.options);
      if (options === null) {
        errorStatus = 'Input request error: Required "options" missing';
        session.addLog('Error: Required "options" missing');
        await session.saveToS3();
        await appendToSummary({ session, errorStatus, req });
        return res.status(400).send('Required "options" missing. Must be a valid JSON object.');
      } else if (typeof options !== 'object' || Array.isArray(options)) {
        errorStatus = 'Input request error: Invalid options format';
        session.addLog('Error: Invalid options format');
        await session.saveToS3();
        await appendToSummary({ session, errorStatus, req });
        return res.status(400).send('Required "options" invalid. Must be a JSON object.');
      }
      session.options = options;
    } catch (error) {
      errorStatus = "Input request error: Error parsing options";
      session.addLog('Error parsing options: ' + error.message);
      await session.saveToS3();
      await appendToSummary({ session, errorStatus, req });
      return res.status(400).send('Required "options" invalid. Must be a valid JSON object.');
    }

    // Log initial request details
    session.addLog(`Request received from ${req.user.id}`);

    const formData = new FormData();
    
    // Create read stream from the uploaded file
    const fileStream = fs.createReadStream(req.file.path);
    formData.append('file', fileStream, {
      filename: req.file.originalname,
      contentType: req.file.mimetype
    });

    // Add options with decision_tree_path for the request only
    const requestOptions = {
      ...options,
      decision_tree_path: true
    };
    formData.append('options', JSON.stringify(requestOptions));

    // Forward any additional form fields (except options which we've already handled)
    Object.keys(req.body).forEach(key => {
      if (key !== 'options') {
        formData.append(key, req.body[key]);
      }
    });

    // Log third-party service request
    session.addLog(`Sending request to GenShare service`);
    session.addLog(`URL: ${processPDFConfig.url}`);

    const response = await axios({
      method: processPDFConfig.method,
      url: processPDFConfig.url,
      data: formData,
      headers: {
        ...formData.getHeaders()
      },
      responseType: 'json',
      maxBodyLength: Infinity
    });

    // Check if response status is not 2xx or 3xx
    if (response.status >= 400) {
      errorStatus = `GenShare Error (HTTP ${response.status})`;
    }

    // Log successful response
    session.addLog(`Received response from GenShare service`);
    session.addLog(`Status: ${response.status}`);

    // Store complete response info before modification
    session.setResponse({
      status: response.status,
      headers: response.headers,
      data: { ...response.data }
    });

    // Remove path property from response data
    let filteredData = {};
    if (response.data && typeof response.data === 'object') {
      filteredData = { response: response.data.response };
    }

    // Save session data and clean up
    session.addLog('Response processing completed');
    await session.saveToS3();
    
    // Log to summary sheet before sending response
    await appendToSummary({ session, errorStatus, req });

    // Clean up temporary file
    fs.unlink(req.file.path, (err) => {
      if (err) {
        console.error('Error deleting temporary file:', err);
      }
    });

    // Forward modified response to client
    res.status(response.status);
    Object.entries(response.headers).forEach(([key, value]) => {
      res.set(key, value);
    });
    res.json(filteredData);

  } catch (error) {
    // Set error status based on the type of error
    if (error.response) {
      errorStatus = `GenShare Error (HTTP ${error.response.status})`;
    } else {
      errorStatus = `${error.message}`;
    }

    // Log error
    session.addLog(`Error processing request: ${error.message}`);
    session.addLog(`Stack: ${error.stack}`);

    try {
      // Save session data with error information
      await session.saveToS3();
      // Log to summary sheet before sending error response
      await appendToSummary({ session, errorStatus, req });
    } catch (s3Error) {
      console.error('Error saving session data:', s3Error);
    }

    // Clean up temporary file if it exists
    if (req.file && req.file.path) {
      fs.unlink(req.file.path, (err) => {
        if (err) console.error('Error deleting temporary file:', err);
      });
    }
    
    // Forward error response if available
    if (error.response) return res.status(error.response.status).send(error.message);
    return res.status(500).send('GenShare returned an error');
  }
};
