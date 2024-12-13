// File: src/controllers/grobidController.js
const axios = require('axios');
const config = require('../config');

const grobidConfig = require(config.grobidConfigPath);
const healthConfig = grobidConfig.health;

exports.getGrobidHealth = async (req, res) => {
  try {
    const response = await axios({
      method: healthConfig.method,
      url: healthConfig.url,
      headers: {
        'Content-Type': 'application/json'
      }
    });

    res.status(response.status);
    Object.entries(response.headers).forEach(([key, value]) => {
      res.set(key, value);
    });
    res.send(response.data);
  } catch (error) {
    if (error.response) return res.status(error.response.status).send(error.message);
    return res.status(500).send('Grobid health check failed');
  }
};
