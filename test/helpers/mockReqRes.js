/**
 * Mock Express req/res builders for unit tests
 */

/**
 * Create a mock Express request object
 * @param {Object} overrides - Properties to override on the request
 * @returns {Object} Mock request object
 */
function createMockReq(overrides = {}) {
  return {
    method: 'POST',
    path: '/processPDF',
    query: {},
    body: {},
    files: null,
    headers: {},
    user: { id: 'testuser' },
    ...overrides
  };
}

/**
 * Create a mock Express response object with jest spies
 * @returns {Object} Mock response object with chainable methods
 */
function createMockRes() {
  const res = {
    statusCode: 200,
    _headers: {},
    _data: null,
    _sent: false
  };

  res.status = jest.fn().mockImplementation((code) => {
    res.statusCode = code;
    return res;
  });

  res.json = jest.fn().mockImplementation((data) => {
    res._data = data;
    res._sent = true;
    return res;
  });

  res.send = jest.fn().mockImplementation((data) => {
    res._data = data;
    res._sent = true;
    return res;
  });

  res.set = jest.fn().mockImplementation((key, value) => {
    res._headers[key] = value;
    return res;
  });

  res.sendStatus = jest.fn().mockImplementation((code) => {
    res.statusCode = code;
    res._sent = true;
    return res;
  });

  return res;
}

/**
 * Create a mock Express next function
 * @returns {jest.Mock}
 */
function createMockNext() {
  return jest.fn();
}

module.exports = { createMockReq, createMockRes, createMockNext };
