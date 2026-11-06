/**
 * Unit tests for the audit trail of a hand edit of a cache entry
 * (PATCH /snapshot-s3-manager/cache/:cache_key): who and what changed.
 */
const { createMockReq, createMockRes } = require('../../helpers/mockReqRes');

jest.mock('../../../src/utils/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
jest.mock('../../../src/utils/cacheManager', () => ({
  isCacheEnabled: jest.fn(() => true),
  readCacheMeta: jest.fn(),
  readCacheResponseArray: jest.fn(),
  patchCacheResponse: jest.fn().mockResolvedValue({}),
  propagateResponseToRequest: jest.fn().mockResolvedValue(undefined)
}));
jest.mock('../../../src/utils/dbManager', () => ({
  getCacheConsumerOwner: jest.fn()
}));

const cacheManager = require('../../../src/utils/cacheManager');
const dbManager = require('../../../src/utils/dbManager');
const { patchCacheEntry, changedFields } = require('../../../src/controllers/cacheController');

const before = () => [
  { name: 'article_id', value: 'A-1' },
  { name: 'reasoning_summary__lm', value: 'old text' },
  { name: 'statistical_checks__lm', value: [{ id: 'grim', verdict: 'pass', name: 'GRIM', advisory: false }] }
];
const call = async ({ body, headers = {} }) => {
  const req = createMockReq({ params: { cache_key: 'k' }, body, headers, user: { id: 'snapshot-s3-manager' } });
  const res = createMockRes();
  await patchCacheEntry(req, res);
  return res;
};

beforeEach(() => {
  jest.clearAllMocks();
  cacheManager.readCacheMeta.mockResolvedValue({ cache_key: 'k' });
  cacheManager.readCacheResponseArray.mockResolvedValue(before());
  dbManager.getCacheConsumerOwner.mockResolvedValue('test');
});

describe('changedFields', () => {
  it('names changed, added and removed items', () => {
    const after = [{ name: 'article_id', value: 'A-1' }, { name: 'reasoning_summary__lm', value: 'new text' }, { name: 'extra', value: 1 }];
    expect(changedFields(before(), after)).toEqual(['reasoning_summary__lm', 'extra', 'statistical_checks__lm']);
  });

  it('ignores the order of keys inside a value', () => {
    const after = before();
    after[2].value = [{ advisory: false, name: 'GRIM', verdict: 'pass', id: 'grim' }];
    expect(changedFields(before(), after)).toEqual([]);
  });

  it('copes with a missing previous response', () => {
    expect(changedFields(null, [{ name: 'a', value: 1 }])).toEqual(['a']);
  });
});

describe('patchCacheEntry audit', () => {
  it('logs the person named by X-Curator and the fields that changed', async () => {
    const response = before();
    response[1].value = 'new text';
    const res = await call({ body: { response, reason: 'typo', propagate_to: ['r1'] }, headers: { 'x-curator': 'alice' } });
    expect(res.json).toHaveBeenCalledWith({ success: true, error: null, skipped: [] });
    expect(cacheManager.patchCacheResponse).toHaveBeenCalledWith('k', response, {
      actor: 'snapshot-s3-manager (alice)',
      reason: 'typo',
      propagated_to: ['r1'],
      summary: { items: 3, changed: ['reasoning_summary__lm'] }
    });
    expect(cacheManager.propagateResponseToRequest).toHaveBeenCalledWith('test', 'r1', response);
  });

  it('keeps the bare actor when no person is named', async () => {
    await call({ body: { response: before() } });
    const audit = cacheManager.patchCacheResponse.mock.calls[0][2];
    expect(audit.actor).toBe('snapshot-s3-manager');
    expect(audit.summary).toEqual({ items: 3, changed: [] });
  });

  it('still saves when the previous response cannot be read', async () => {
    cacheManager.readCacheResponseArray.mockRejectedValue(new Error('S3 down'));
    const res = await call({ body: { response: before(), reason: 'x' } });
    expect(res.json).toHaveBeenCalledWith({ success: true, error: null, skipped: [] });
    expect(cacheManager.patchCacheResponse.mock.calls[0][2].summary).toEqual({ items: 3 });
  });

  it('refuses a body without a response array (400) and an unknown entry (404)', async () => {
    expect((await call({ body: { reason: 'x' } })).status).toHaveBeenCalledWith(400);
    cacheManager.readCacheMeta.mockResolvedValue(null);
    expect((await call({ body: { response: [] } })).status).toHaveBeenCalledWith(404);
    expect(cacheManager.patchCacheResponse).not.toHaveBeenCalled();
  });
});
