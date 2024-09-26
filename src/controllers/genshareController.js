// File: src/controllers/genshareController.js
const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');
const config = require('../config');


const genshareConfig = require(config.genshareConfigPath);
const processPDFConfig = genshareConfig.processPDF;

exports.processPDF = async (req, res) => {
  if (!req.file)
    return res.status(400).send('Required "file" missing.');

  if (req.file.mimetype !== "application/pdf")
    return res.status(400).send('Required "file" invalid. Must have mimetype "application/pdf"');

  try {
    let options = JSON.parse(req.body.options);
    if (options === null)
      return res.status(400).send('Required "options" missing. Must be a valid JSON object.');
    else if (typeof options !== 'object' || Array.isArray(options))
      return res.status(400).send('Required "options" invalid. Must be a JSON object.');
  } catch (error) {
    return res.status(400).send('Required "options" invalid. Must be a valid JSON object.');
  }

  const formData = new FormData();
  formData.append('file', req.file.buffer, {
    filename: req.file.originalname,
    contentType: req.file.mimetype
  });

  // Forward any additional form fields
  Object.keys(req.body).forEach(key => {
    formData.append(key, req.body[key]);
  });

  try {
    const response = await axios({
      method: processPDFConfig.method,
      url: processPDFConfig.url,
      data: formData,
      headers: {
        ...formData.getHeaders()
      },
      responseType: 'stream'  // Important for larger responses
    });

    // Forward the status code
    res.status(response.status);

    // Forward the headers
    Object.entries(response.headers).forEach(([key, value]) => {
      res.set(key, value);
    });

    // Pipe the response body
    response.data.pipe(res);
  } catch (error) {
    // Forward error response if available
    if (error.response) return res.status(error.response.status).send(error.message);
    return res.status(500).send('GenShare returned an error');
  }
};
