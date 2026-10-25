// Unit tests for services/storage.js with the @vercel/blob SDK mocked.
jest.mock('@vercel/blob', () => ({
  del: jest.fn(),
  head: jest.fn(),
  get: jest.fn(),
  issueSignedToken: jest.fn(),
  presignUrl: jest.fn(),
}));

const fs = require('fs');
const path = require('path');
const blob = require('@vercel/blob');
const env = require('../src/config/env');
const storage = require('../src/services/storage');

beforeEach(() => jest.clearAllMocks());

// A stand-in for the web ReadableStream that @vercel/blob's get() returns.
function streamOf(...chunks) {
  const reader = {
    read: jest.fn(async () => (chunks.length ? { done: false, value: Uint8Array.from(chunks.shift()) } : { done: true })),
    cancel: jest.fn(async () => {}),
  };
  return { stream: { getReader: () => reader }, reader };
}

describe('storage service', () => {
  test('STORE-01 blob references are recognised and unwrapped', () => {
    expect(storage.isBlobReference('blob:applications/a/b.pdf')).toBe(true);
    expect(storage.isBlobReference('uploads/b.pdf')).toBe(false);
    expect(storage.blobPathname('blob:applications/a/b.pdf')).toBe('applications/a/b.pdf');
  });

  test('STORE-02 removing a blob reference deletes the blob', async () => {
    await storage.removeStoredFile('blob:applications/a/b.pdf');
    expect(blob.del).toHaveBeenCalledWith('applications/a/b.pdf');
  });

  test('STORE-03 removing a disk reference deletes the file, and a missing file is fine', async () => {
    fs.mkdirSync(env.uploadDir, { recursive: true });
    const file = path.join(env.uploadDir, 'to-delete.pdf');
    fs.writeFileSync(file, 'x');
    await storage.removeStoredFile(path.relative(env.backendRoot, file));
    expect(fs.existsSync(file)).toBe(false);
    await expect(storage.removeStoredFile(path.relative(env.backendRoot, file))).resolves.toBeUndefined();
    expect(blob.del).not.toHaveBeenCalled();
  });

  test('STORE-04 headBlob returns null for a missing blob and rethrows other errors', async () => {
    blob.head.mockRejectedValueOnce(Object.assign(new Error('nope'), { name: 'BlobNotFoundError' }));
    await expect(storage.headBlob('x')).resolves.toBeNull();
    blob.head.mockRejectedValueOnce(new Error('network down'));
    await expect(storage.headBlob('x')).rejects.toThrow('network down');
  });

  test('STORE-05 readBlobHeader reads only what it needs from a private blob, then cancels', async () => {
    const { stream, reader } = streamOf([0x25, 0x50, 0x44], [0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0x0a], [0x99]);
    blob.get.mockResolvedValue({ stream });
    const header = await storage.readBlobHeader('applications/a/b.pdf');
    expect(header.toString()).toBe('%PDF-1.7');
    expect(blob.get).toHaveBeenCalledWith('applications/a/b.pdf', { access: 'private', useCache: false });
    expect(reader.read).toHaveBeenCalledTimes(2); // never touched the third chunk
    expect(reader.cancel).toHaveBeenCalled();
  });

  test('STORE-06 readBlobHeader copes with an empty blob', async () => {
    const { stream } = streamOf();
    blob.get.mockResolvedValue({ stream });
    expect((await storage.readBlobHeader('x')).length).toBe(0);
  });

  test('STORE-07 signedDownloadUrl asks for a get-only token for one pathname, expiring in 5 minutes', async () => {
    blob.issueSignedToken.mockResolvedValue({ delegationToken: 'd', clientSigningToken: 'c' });
    blob.presignUrl.mockResolvedValue({ presignedUrl: 'https://signed' });
    const before = Date.now();
    const { url, expiresAt } = await storage.signedDownloadUrl('applications/a/b.pdf');
    expect(url).toBe('https://signed');
    const [tokenOptions] = blob.issueSignedToken.mock.calls[0];
    expect(tokenOptions).toMatchObject({ pathname: 'applications/a/b.pdf', operations: ['get'] });
    expect(tokenOptions.validUntil - before).toBeGreaterThanOrEqual(5 * 60 * 1000 - 50);
    expect(tokenOptions.validUntil - before).toBeLessThanOrEqual(5 * 60 * 1000 + 1000);
    expect(blob.presignUrl.mock.calls[0][1]).toMatchObject({ operation: 'get', access: 'private' });
    expect(new Date(expiresAt).getTime()).toBe(tokenOptions.validUntil);
  });
});
