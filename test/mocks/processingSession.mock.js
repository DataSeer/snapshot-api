/**
 * Mock ProcessingSession class for unit tests
 * Mirrors the real ProcessingSession API with jest.fn() stubs
 */
function createMockSession(overrides = {}) {
  return {
    requestId: overrides.requestId || 'mock-request-id-123',
    userId: overrides.userId || 'testuser',
    url: 'https://s3.console.aws.amazon.com/s3/buckets/mock-bucket',
    files: [],
    logs: [],
    origin: { type: 'direct', service: null },
    apiRequest: null,
    apiResponse: null,
    genshare: {
      isActive: false,
      version: null,
      request: null,
      response: null
    },
    report: null,
    startTime: new Date(),
    endTime: null,
    duration: -1,
    snapshotAPIVersion: '',
    genshareVersion: '',

    setOrigin: jest.fn().mockReturnThis(),
    setAPIRequest: jest.fn().mockReturnThis(),
    setAPIResponse: jest.fn().mockReturnThis(),
    initGenShare: jest.fn().mockReturnThis(),
    addLog: jest.fn(),
    addFile: jest.fn().mockReturnThis(),
    setGenshareRequest: jest.fn().mockReturnThis(),
    setGenshareResponse: jest.fn().mockReturnThis(),
    setReport: jest.fn().mockReturnThis(),
    setServiceResponse: jest.fn().mockReturnThis(),
    setSnapshotAPIVersion: jest.fn(),
    setGenshareVersion: jest.fn(),
    getSnapshotAPIVersion: jest.fn().mockReturnValue(''),
    getGenshareVersion: jest.fn().mockReturnValue(''),
    getBasePath: jest.fn().mockReturnValue('mock-folder/testuser/mock-request-id-123'),
    getDuration: jest.fn().mockReturnValue(100),
    saveToS3: jest.fn().mockResolvedValue('mock-request-id-123'),

    ...overrides
  };
}

module.exports = { createMockSession };
