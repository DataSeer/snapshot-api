/**
 * Shared test data constants derived from CSV v3.11.0 production data
 */

// Options matching latest data structure (v3.11.0 format)
const VALID_OPTIONS_QAEF = {
  article_id: 'QAEF-2026-0289',
  document_type: 'article',
  journal_name: 'QAEF',
  article_title: 'Test Article for QAEF Journal'
};

const VALID_OPTIONS_QAEN = {
  article_id: 'QAEN-2026-0071',
  document_type: 'article',
  journal_name: 'QAEN',
  article_title: 'Test Article for QAEN Journal'
};

const VALID_OPTIONS_ASYNC = {
  article_id: 'test',
  document_type: 'article',
  debug: false,
  editorial_policy: 'TFOD'
};

const VALID_OPTIONS_MINIMAL = {
  article_id: 'TEST-2026-0001',
  document_type: 'article'
};

// Mock file objects matching multer upload.fields() output
const MOCK_PDF_FILE = {
  fieldname: 'file',
  originalname: 'R36382-63891157.pdf',
  mimetype: 'application/pdf',
  size: 1404214,
  path: 'tmp/mock-file.pdf'
};

const MOCK_SUPPLEMENTARY_ZIP = {
  fieldname: 'supplementary_file',
  originalname: 'supp.zip',
  mimetype: 'application/zip',
  size: 524288,
  path: 'tmp/mock-supp.zip'
};

const MOCK_SUPPLEMENTARY_XZIP = {
  fieldname: 'supplementary_file',
  originalname: 'supp.zip',
  mimetype: 'application/x-zip-compressed',
  size: 524288,
  path: 'tmp/mock-supp-xzip.zip'
};

const MOCK_SUPPLEMENTARY_INVALID = {
  fieldname: 'supplementary_file',
  originalname: 'supp.pdf',
  mimetype: 'application/pdf',
  size: 200000,
  path: 'tmp/mock-bad-supp.pdf'
};

// Mock genshare response
const MOCK_GENSHARE_RESPONSE = {
  status: 200,
  data: { results: [{ type: 'article', score: 0.95 }] },
  headers: { 'content-type': 'application/json' }
};

const MOCK_GENSHARE_ERROR_RESPONSE = {
  response: {
    status: 502
  },
  message: 'GenShare service unavailable'
};

// Test user data
const TEST_USER = {
  id: 'testuser',
  name: 'Test User'
};

const TEST_USER_KWG = {
  id: 'KWG',
  name: 'KWG User'
};

const TEST_USER_ADMIN = {
  id: 'admin',
  name: 'Admin User'
};

const TEST_USER_BLOCKED = {
  id: 'blockeduser',
  name: 'Blocked User'
};

// JWT tokens for testing
const VALID_TOKEN = 'valid-test-token';
const EXPIRED_TOKEN = 'expired-test-token';
const INVALID_TOKEN = 'invalid-test-token';

module.exports = {
  VALID_OPTIONS_QAEF,
  VALID_OPTIONS_QAEN,
  VALID_OPTIONS_ASYNC,
  VALID_OPTIONS_MINIMAL,
  MOCK_PDF_FILE,
  MOCK_SUPPLEMENTARY_ZIP,
  MOCK_SUPPLEMENTARY_XZIP,
  MOCK_SUPPLEMENTARY_INVALID,
  MOCK_GENSHARE_RESPONSE,
  MOCK_GENSHARE_ERROR_RESPONSE,
  TEST_USER,
  TEST_USER_KWG,
  TEST_USER_ADMIN,
  TEST_USER_BLOCKED,
  VALID_TOKEN,
  EXPIRED_TOKEN,
  INVALID_TOKEN
};
