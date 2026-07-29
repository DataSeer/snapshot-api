/**
 * Unit tests for validateSupplementaryFiles middleware
 * This middleware is defined inline in src/routes/index.js
 * We recreate it here for isolated testing
 */

const { createMockReq, createMockRes, createMockNext } = require('../helpers/mockReqRes');

// Recreate the middleware exactly as defined in routes/index.js
const validateSupplementaryFiles = (req, res, next) => {
  if (req.files && req.files.supplementary_file) {
    const supplementaryFiles = req.files.supplementary_file;
    const supplementaryFile = Array.isArray(supplementaryFiles) ? supplementaryFiles[0] : supplementaryFiles;

    if (supplementaryFile) {
      const isZip = supplementaryFile.mimetype === 'application/zip' ||
                   supplementaryFile.mimetype === 'application/x-zip-compressed' ||
                   supplementaryFile.originalname.toLowerCase().endsWith('.zip');

      if (!isZip) {
        return res.status(400).json({
          error: 'Invalid supplementary files format. Only ZIP files are supported.'
        });
      }
    }
  }
  next();
};

describe('validateSupplementaryFiles middleware', () => {
  let req, res, next;

  beforeEach(() => {
    req = createMockReq();
    res = createMockRes();
    next = createMockNext();
  });

  it('should call next() when no supplementary file is present', () => {
    req.files = { file: [{ originalname: 'test.pdf', mimetype: 'application/pdf' }] };
    validateSupplementaryFiles(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('should call next() when req.files is null', () => {
    req.files = null;
    validateSupplementaryFiles(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('should call next() for application/zip mimetype', () => {
    req.files = {
      supplementary_file: [{
        originalname: 'supp.zip',
        mimetype: 'application/zip'
      }]
    };
    validateSupplementaryFiles(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('should call next() for application/x-zip-compressed mimetype', () => {
    req.files = {
      supplementary_file: [{
        originalname: 'supp.zip',
        mimetype: 'application/x-zip-compressed'
      }]
    };
    validateSupplementaryFiles(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('should call next() for .zip extension regardless of mimetype', () => {
    req.files = {
      supplementary_file: [{
        originalname: 'archive.ZIP',
        mimetype: 'application/octet-stream'
      }]
    };
    validateSupplementaryFiles(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('should return 400 for non-ZIP supplementary file', () => {
    req.files = {
      supplementary_file: [{
        originalname: 'supp.pdf',
        mimetype: 'application/pdf'
      }]
    };
    validateSupplementaryFiles(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining('ZIP') })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('should return 400 for non-array supplementary file that is not ZIP', () => {
    req.files = {
      supplementary_file: {
        originalname: 'supp.tar.gz',
        mimetype: 'application/gzip'
      }
    };
    validateSupplementaryFiles(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });
});
