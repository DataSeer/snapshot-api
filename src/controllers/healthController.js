// File: src/controllers/healthController.js
const axios = require('axios');
const config = require('../config');

const genshareConfig = require(config.genshareConfigPath);
const grobidConfig = require(config.grobidConfigPath);
const datastetConfig = require(config.datastetConfigPath);

const checkHealth = async (config, serviceName) => {
  const request = `${config.health.method.toUpperCase()} ${config.health.url}`;
  
  try {
    const response = await axios({
      method: config.health.method,
      url: config.health.url,
      headers: {
        'Content-Type': 'application/json'
      }
    });
    return {
      err: null,
      request,
      response: {
        status: response.status,
        data: response.data
      }
    };
  } catch (error) {
    return {
      err: error.message,
      request,
      response: {
        status: error.response?.status || 500,
        data: null
      }
    };
  }
};

exports.getPing = async (req, res) => {
  try {
    const [genshareResult, grobidResult, datastetResult] = await Promise.all([
      checkHealth(genshareConfig, 'genshare'),
      checkHealth(grobidConfig, 'grobid'),
      checkHealth(datastetConfig, 'datastet')
    ]);

    const allHealthy = [genshareResult, grobidResult, datastetResult]
      .every(service => service.response.status === 200);

    const overallStatus = allHealthy ? 200 : 503;

    res.status(overallStatus).json({
      status: allHealthy ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      services: {
        genshare: genshareResult,
        grobid: grobidResult,
        datastet: datastetResult
      }
    });
  } catch (error) {
    const failedRequest = {
      err: error.message,
      request: 'Request failed before reaching service',
      response: {
        status: 500,
        data: null
      }
    };

    res.status(500).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      services: {
        genshare: failedRequest,
        grobid: failedRequest,
        datastet: failedRequest
      }
    });
  }
};
