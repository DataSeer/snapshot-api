/**
 * Integration tests for s3Storage with real S3
 * Requires conf/aws.s3.test.json with valid credentials
 * Uses snapshot-api-test/ prefix for isolation
 */

const { setupTestEnv, validateTestConfigs } = require('../../helpers/testConfig');
const { validateTestPrefix, cleanupTestPrefix, generateTestRequestId } = require('../../helpers/testS3');

// Set up test environment before requiring modules
setupTestEnv();

// Validate required configs exist
try {
  validateTestConfigs(['aws.s3.test.json']);
} catch (err) {
  // Skip all tests if config is missing
  describe('S3 Storage Integration', () => {
    test.skip('SKIPPED: ' + err.message, () => {});
  });
  // Prevent further execution
  // eslint-disable-next-line no-global-assign
  module.exports = {};
  return;
}

const {
  uploadBatchToS3,
  listObjects,
  getFile,
  deleteObjectsByPrefix,
  s3Config
} = require('../../../src/utils/s3Storage');

// Safety check: ensure we're using the test prefix
validateTestPrefix(s3Config);

const testPrefix = `${s3Config.s3Folder}/s3-integration-test`;
const testRequestId = generateTestRequestId();
const testBasePath = `${testPrefix}/${testRequestId}`;

afterAll(async () => {
  // Clean up all test objects
  await cleanupTestPrefix(deleteObjectsByPrefix, `${testPrefix}/`);
});

describe('S3 Storage Integration', () => {
  describe('Upload Operations', () => {
    test('should upload a single file', async () => {
      const key = `${testBasePath}/single-file.json`;
      await uploadBatchToS3([{
        key,
        data: JSON.stringify({ test: true }),
        contentType: 'application/json'
      }]);

      const content = await getFile(key);
      expect(JSON.parse(content)).toEqual({ test: true });
    });

    test('should upload multiple files in batch', async () => {
      const files = [
        {
          key: `${testBasePath}/batch/file1.json`,
          data: JSON.stringify({ file: 1 }),
          contentType: 'application/json'
        },
        {
          key: `${testBasePath}/batch/file2.txt`,
          data: 'Hello World',
          contentType: 'text/plain'
        },
        {
          key: `${testBasePath}/batch/file3.json`,
          data: JSON.stringify({ file: 3 }),
          contentType: 'application/json'
        }
      ];

      await uploadBatchToS3(files);

      const content1 = await getFile(`${testBasePath}/batch/file1.json`);
      expect(JSON.parse(content1)).toEqual({ file: 1 });

      const content2 = await getFile(`${testBasePath}/batch/file2.txt`);
      expect(content2).toBe('Hello World');

      const content3 = await getFile(`${testBasePath}/batch/file3.json`);
      expect(JSON.parse(content3)).toEqual({ file: 3 });
    });
  });

  describe('Retrieve Operations', () => {
    test('should retrieve file content with getFile', async () => {
      const key = `${testBasePath}/single-file.json`;
      const content = await getFile(key);
      expect(content).toBeDefined();
      expect(typeof content).toBe('string');
      const parsed = JSON.parse(content);
      expect(parsed.test).toBe(true);
    });

    test('should throw for non-existent file', async () => {
      await expect(
        getFile(`${testBasePath}/nonexistent-file.json`)
      ).rejects.toThrow();
    });
  });

  describe('List Operations', () => {
    test('should list objects under a prefix', async () => {
      const objects = await listObjects(`${testBasePath}/`);
      expect(objects.length).toBeGreaterThanOrEqual(4); // single-file + 3 batch files
      objects.forEach(obj => {
        expect(obj.Key).toBeDefined();
        expect(obj.Key.startsWith(testBasePath)).toBe(true);
      });
    });

    test('should list objects under a sub-prefix', async () => {
      const objects = await listObjects(`${testBasePath}/batch/`);
      expect(objects.length).toBe(3);
    });

    test('should return empty array for non-existent prefix', async () => {
      const objects = await listObjects(`${testPrefix}/nonexistent-prefix/`);
      expect(objects).toEqual([]);
    });
  });

  describe('Delete Operations', () => {
    test('should delete objects by prefix', async () => {
      // First upload something to a delete-test prefix
      const deleteTestPath = `${testBasePath}/delete-test`;
      await uploadBatchToS3([
        { key: `${deleteTestPath}/a.json`, data: '{}', contentType: 'application/json' },
        { key: `${deleteTestPath}/b.json`, data: '{}', contentType: 'application/json' }
      ]);

      // Verify they exist
      let objects = await listObjects(`${deleteTestPath}/`);
      expect(objects.length).toBe(2);

      // Delete them
      const deletedCount = await deleteObjectsByPrefix(`${deleteTestPath}/`);
      expect(deletedCount).toBe(2);

      // Verify they're gone
      objects = await listObjects(`${deleteTestPath}/`);
      expect(objects.length).toBe(0);
    });

    test('should handle deletion of non-existent prefix gracefully', async () => {
      const deletedCount = await deleteObjectsByPrefix(`${testPrefix}/nonexistent/`);
      expect(deletedCount).toBe(0);
    });
  });
});
