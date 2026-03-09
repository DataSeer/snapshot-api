/**
 * Unit tests for addEditorialPolicyForUser helper
 */

// Mock modules that load conf/*.json at require-time
jest.mock('../../../src/utils/s3Storage', () => ({
  ProcessingSession: jest.fn()
}));
jest.mock('../../../src/utils/genshareManager', () => ({}));
jest.mock('../../../src/utils/queueManager', () => ({
  JobType: { GENSHARE_SUBMISSION: 'genshare_submission' },
  enqueueJob: jest.fn()
}));
jest.mock('../../../src/utils/userManager', () => ({
  getUserById: jest.fn(),
  isAdmin: jest.fn()
}));

const { addEditorialPolicyForUser } = require('../../../src/controllers/genshareController');
const { createMockSession } = require('../../mocks/processingSession.mock');

describe('addEditorialPolicyForUser', () => {
  let session;

  beforeEach(() => {
    session = createMockSession();
  });

  it('should return options unchanged for non-KWG user', () => {
    const options = { article_id: 'QAEF-2026-0001', document_type: 'article' };
    const result = addEditorialPolicyForUser(options, 'testuser', session);
    expect(result.editorial_policy).toBeUndefined();
    expect(session.addLog).not.toHaveBeenCalled();
  });

  it('should return options unchanged when article_id is missing', () => {
    const options = { document_type: 'article' };
    const result = addEditorialPolicyForUser(options, 'KWG', session);
    expect(result.editorial_policy).toBeUndefined();
  });

  it('should return options unchanged when article_id is not a string', () => {
    const options = { article_id: 12345, document_type: 'article' };
    const result = addEditorialPolicyForUser(options, 'KWG', session);
    expect(result.editorial_policy).toBeUndefined();
  });

  it('should return options unchanged when editorial_policy is already set', () => {
    const options = { article_id: 'QAEF-2026-0001', editorial_policy: 'CUSTOM' };
    const result = addEditorialPolicyForUser(options, 'KWG', session);
    expect(result.editorial_policy).toBe('CUSTOM');
    expect(session.addLog).not.toHaveBeenCalled();
  });

  it('should set SURR for QAEF prefix with KWG user', () => {
    const options = { article_id: 'QAEF-2026-0289', document_type: 'article' };
    const result = addEditorialPolicyForUser(options, 'KWG', session);
    expect(result.editorial_policy).toBe('SURR');
    expect(session.addLog).toHaveBeenCalledWith(
      expect.stringContaining('SURR')
    );
  });

  it('should set TFOD for QAEN prefix with KWG user', () => {
    const options = { article_id: 'QAEN-2026-0071', document_type: 'article' };
    const result = addEditorialPolicyForUser(options, 'KWG', session);
    expect(result.editorial_policy).toBe('TFOD');
    expect(session.addLog).toHaveBeenCalledWith(
      expect.stringContaining('TFOD')
    );
  });

  it('should NOT set editorial_policy for unknown prefix with KWG user', () => {
    const options = { article_id: 'XYZW-2026-0001', document_type: 'article' };
    const result = addEditorialPolicyForUser(options, 'KWG', session);
    expect(result.editorial_policy).toBeUndefined();
    expect(session.addLog).not.toHaveBeenCalled();
  });

  it('should log when editorial_policy is added', () => {
    const options = { article_id: 'QAEF-2026-0001' };
    addEditorialPolicyForUser(options, 'KWG', session);
    expect(session.addLog).toHaveBeenCalledTimes(1);
    expect(session.addLog).toHaveBeenCalledWith(
      expect.stringContaining('editorial_policy')
    );
  });

  it('should not modify other options fields', () => {
    const options = {
      article_id: 'QAEF-2026-0001',
      document_type: 'article',
      journal_name: 'QAEF',
      article_title: 'Some Title'
    };
    const result = addEditorialPolicyForUser(options, 'KWG', session);
    expect(result.document_type).toBe('article');
    expect(result.journal_name).toBe('QAEF');
    expect(result.article_title).toBe('Some Title');
    expect(result.editorial_policy).toBe('SURR');
  });
});
