// The only file that knows WHERE uploaded bytes live. Everything else stores
// and passes around a reference string (Document.filePath):
//   "uploads/<uuid>.pdf"                 a file on local disk (disk driver)
//   "blob:applications/<appId>/<uuid>.pdf"  a private Vercel Blob (blob driver)
// The "blob:" prefix lets both kinds coexist, e.g. in tests.
const fs = require('fs/promises');
const path = require('path');
const env = require('../config/env');

const BLOB_PREFIX = 'blob:';

// Required lazily so local development never needs the Blob package configured.
const blobSdk = () => require('@vercel/blob');

function isBlobReference(filePath) {
  return typeof filePath === 'string' && filePath.startsWith(BLOB_PREFIX);
}

function blobPathname(filePath) {
  return filePath.slice(BLOB_PREFIX.length);
}

// Deletes the stored bytes behind a reference. "Already gone" is not an error,
// so cleanup can never break a request.
async function removeStoredFile(filePath) {
  if (!filePath) return;
  if (isBlobReference(filePath)) {
    await blobSdk().del(blobPathname(filePath));
    return;
  }
  await fs.rm(path.resolve(env.backendRoot, filePath), { force: true });
}

// Blob size and existence, straight from storage (never from the client).
// Returns null if there is no such blob.
async function headBlob(pathname) {
  try {
    return await blobSdk().head(pathname);
  } catch (err) {
    if (err.name === 'BlobNotFoundError') return null;
    throw err;
  }
}

// First few bytes of a private blob, for the magic-byte check. Reads one chunk
// and cancels the rest, so a 5 MB file is never fully downloaded.
async function readBlobHeader(pathname, length = 8) {
  const result = await blobSdk().get(pathname, { access: 'private', useCache: false });
  if (!result?.stream) return Buffer.alloc(0);
  const reader = result.stream.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (total < length) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(Buffer.from(value));
      total += value.length;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks).subarray(0, length);
}

// A short-lived link to a private blob for the admin's "View" button. The file
// goes from Blob straight to the browser, never through the API (a Vercel
// function can't send a response over 4.5 MB).
async function signedDownloadUrl(pathname, minutes = 5) {
  const { issueSignedToken, presignUrl } = blobSdk();
  const validUntil = Date.now() + minutes * 60 * 1000;
  const token = await issueSignedToken({ pathname, operations: ['get'], validUntil });
  const { presignedUrl } = await presignUrl(token, { operation: 'get', pathname, access: 'private', validUntil });
  return { url: presignedUrl, expiresAt: new Date(validUntil).toISOString() };
}

module.exports = {
  BLOB_PREFIX,
  isBlobReference,
  blobPathname,
  removeStoredFile,
  headBlob,
  readBlobHeader,
  signedDownloadUrl,
};
