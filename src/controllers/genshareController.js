// File: src/controllers/genshareController.js
const axios = require('axios');
const FormData = require('form-data');
const config = require('../config');

const genshareConfig = require(config.genshareConfigPath);
const processPDFConfig = genshareConfig.processPDF;

exports.processPDF = async (file, fields, req, res) => {
  // Validate file type using content-type header
  const contentType = req.headers['content-type'];
  if (!contentType?.includes('multipart/form-data')) {
    return res.status(400).send('Invalid request format. Must be multipart/form-data');
  }

  try {
    let options = JSON.parse(fields.options);
    if (!options || typeof options !== 'object' || Array.isArray(options)) {
      return res.status(400).send('Required "options" invalid. Must be a valid JSON object.');
    }
  } catch (error) {
    return res.status(400).send('Required "options" invalid. Must be a valid JSON object.');
  }

  const formData = new FormData();
  formData.append('file', file.stream, {
    filename: file.filename || 'document.pdf',
    contentType: 'application/pdf'
  });

  Object.keys(fields).forEach(key => {
    formData.append(key, fields[key]);
  });

  try {
    const response = await axios({
      method: processPDFConfig.method,
      url: processPDFConfig.url,
      data: formData,
      headers: {
        ...formData.getHeaders()
      },
      responseType: 'stream'
    });

    res.status(response.status);
    Object.entries(response.headers).forEach(([key, value]) => {
      res.set(key, value);
    });
    response.data.pipe(res);
  } catch (error) {
    if (error.response) return res.status(error.response.status).send(error.message);
    return res.status(500).send('GenShare returned an error');
  }
};
