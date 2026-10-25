// Rule DU (document upload). Pure functions only: no Express, no disk, no
// database. That keeps every branch easy to unit-test with plain values.
const httpError = require('../utils/httpError');

// 1 MB = 1,048,576 bytes (binary megabyte), so the limit is 5,242,880 bytes.
// The limit is INCLUSIVE: 5,242,880 is accepted, 5,242,881 is rejected.
const BYTES_PER_MB = 1024 * 1024;
const MAX_MB = 5;
const MAX_BYTES = MAX_MB * BYTES_PER_MB;

// Allowed extensions, the MIME type we record for each, and the "magic bytes"
// every real file of that type starts with.
const FILE_TYPES = {
  pdf: { mimeType: 'application/pdf', magic: [0x25, 0x50, 0x44, 0x46] }, // "%PDF"
  jpg: { mimeType: 'image/jpeg', magic: [0xff, 0xd8, 0xff] },
  jpeg: { mimeType: 'image/jpeg', magic: [0xff, 0xd8, 0xff] },
  png: { mimeType: 'image/png', magic: [0x89, 0x50, 0x4e, 0x47] },
};

const MESSAGES = Object.freeze({
  INVALID_TYPE: 'Invalid file type: only PDF, JPG and PNG are allowed',
  EMPTY: 'File is empty',
  TOO_LARGE: 'File too large — maximum allowed size is 5 MB',
  UNREADABLE: 'File is corrupted or unreadable',
  INVALID_SIZE: 'Invalid file size',
});

const SIZE = Object.freeze({ OK: 'OK', EMPTY: 'EMPTY', TOO_LARGE: 'TOO_LARGE' });

function normaliseExtension(extension) {
  return String(extension ?? '').trim().toLowerCase().replace(/^\./, '');
}

function isAllowedType(extension) {
  return Object.hasOwn(FILE_TYPES, normaliseExtension(extension));
}

// Classifies a RAW byte count. Never pass rounded megabytes: 5.0000009 MB
// rounds to "5.00" but is over the limit.
// Anything that isn't a non-negative whole number (negative, NaN, Infinity,
// 1.5, the string "5MB") is not a size at all, so it throws a 400 instead of
// returning a result that could be mistaken for "valid".
function checkFileSize(sizeBytes) {
  if (typeof sizeBytes !== 'number' || !Number.isInteger(sizeBytes) || sizeBytes < 0) {
    throw httpError(400, MESSAGES.INVALID_SIZE);
  }
  if (sizeBytes === 0) return SIZE.EMPTY;
  if (sizeBytes > MAX_BYTES) return SIZE.TOO_LARGE; // strictly greater: the limit itself is allowed
  return SIZE.OK;
}

// "5,242,881 bytes (5.000001 MB)". Six decimals so a file 1 byte over the limit
// never displays as "5.00 MB", which would look like it should have passed.
function describeSize(sizeBytes) {
  const mb = (sizeBytes / BYTES_PER_MB).toFixed(6).replace(/\.?0+$/, '');
  return `${sizeBytes.toLocaleString('en-US')} bytes (${mb} MB)`;
}

function tooLargeMessage(sizeBytes) {
  // sizeBytes is unknown when multer stopped reading at the limit.
  const detail =
    sizeBytes === undefined
      ? `more than ${MAX_BYTES.toLocaleString('en-US')} bytes received`
      : `your file is ${describeSize(sizeBytes)}`;
  return `${MESSAGES.TOO_LARGE} (${detail})`;
}

// Does the file's first bytes match what its extension claims?
// A text file renamed to .pdf, or a PNG renamed to .jpg, fails this check.
function hasValidSignature(headerBytes, extension) {
  const type = FILE_TYPES[normaliseExtension(extension)];
  if (!type || !headerBytes || headerBytes.length < type.magic.length) return false;
  return type.magic.every((byte, i) => headerBytes[i] === byte);
}

// The full Rule DU decision. Conditions are checked in a fixed order and the
// FIRST failure is reported: type, then size, then readability.
// Returns { valid, code, message }.
function validateDocument({ extension, sizeBytes, isReadable }) {
  if (!isAllowedType(extension)) {
    return { valid: false, code: 'INVALID_TYPE', message: MESSAGES.INVALID_TYPE };
  }

  const size = checkFileSize(sizeBytes); // throws 400 for a nonsense size
  if (size === SIZE.EMPTY) {
    return { valid: false, code: 'EMPTY', message: MESSAGES.EMPTY };
  }
  if (size === SIZE.TOO_LARGE) {
    return { valid: false, code: 'TOO_LARGE', message: tooLargeMessage(sizeBytes) };
  }

  if (isReadable !== true) {
    return { valid: false, code: 'UNREADABLE', message: MESSAGES.UNREADABLE };
  }

  return { valid: true, code: 'VALID', message: 'Valid' };
}

function mimeTypeFor(extension) {
  return FILE_TYPES[normaliseExtension(extension)]?.mimeType ?? 'application/octet-stream';
}

module.exports = {
  MAX_BYTES,
  MESSAGES,
  SIZE,
  checkFileSize,
  validateDocument,
  hasValidSignature,
  tooLargeMessage,
  describeSize,
  isAllowedType,
  normaliseExtension,
  mimeTypeFor,
};
