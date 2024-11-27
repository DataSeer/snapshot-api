// File: src/routes/genshare.js
const express = require('express');
const busboy = require('busboy');
const { processPDF } = require('../controllers/genshareController');

const router = express.Router();

// processPDF route at root level
router.post('/', (req, res) => {
  const bb = busboy({ headers: req.headers });
  const fields = {};
  let fileData = null;

  bb.on('field', (name, val) => {
    fields[name] = val;
  });

  bb.on('file', (name, stream, info) => {
    if (info.mimeType !== 'application/pdf') {
      return res.status(400).json({ error: 'File must be a PDF' });
    }
    fileData = { name, stream, info };
    stream.resume(); // Properly consume stream even when skipping
  });

  bb.on('close', () => {
    if (fileData) {
      processPDF(fileData, fields, req, res);
    } else {
      fileData?.stream?.resume(); // Ensure stream is consumed if exists
      res.status(400).json({ error: 'No PDF file provided' });
    }
  });

  req.pipe(bb);
});

module.exports = router;
