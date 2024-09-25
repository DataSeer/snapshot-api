// File: src/controllers/genshareController.js
const fs = require('fs');
const axios = require('axios');
const config = require('../config');

exports.processPDF = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded.' });
    }

    let options;
    try {
      options = JSON.parse(req.body.options);
      if (typeof options !== 'object' || options === null) {
        throw new Error('Options must be a valid JSON object');
      }
    } catch (error) {
      return res.status(400).json({ error: 'Invalid options provided. Must be a valid JSON object.' });
    }

    const pdfFile = fs.readFileSync(req.file.path);

    const genshareConfig = JSON.parse(fs.readFileSync(config.genshareConfigPath, 'utf8'));
    const processPDFConfig = genshareConfig.processPDF;

    const formData = new FormData();
    formData.append('input', new Blob([pdfFile]), 'input.pdf');
    formData.append('options', JSON.stringify(options));

    const response = await axios({
      method: processPDFConfig.method,
      url: processPDFConfig.url,
      data: formData,
      headers: {
        ...formData.getHeaders(),
        'Authorization': `Bearer ${processPDFConfig.apiKey}`
      }
    });

    res.json(response.data);
  } catch (error) {
    console.error('Error processing PDF:', error);
    res.status(500).json({ error: 'Error processing PDF', details: error.message });
  } finally {
    if (req.file) {
      fs.unlinkSync(req.file.path);
    }
  }
};
