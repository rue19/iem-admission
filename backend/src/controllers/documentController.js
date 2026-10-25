const fs = require('fs/promises');
const path = require('path');
const env = require('../config/env');
const Application = require('../models/Application');
const Document = require('../models/Document');
const { DOCUMENT_TYPES, REQUIRED_DOCUMENT_TYPES } = require('../models/Document');
const { APPLICATION_STATUS } = require('../config/constants');
const {
  MAX_BYTES,
  MESSAGES,
  validateDocument,
  hasValidSignature,
  isAllowedType,
  normaliseExtension,
  mimeTypeFor,
} = require('../services/documentValidation');
const storage = require('../services/storage');
const httpError = require('../utils/httpError');

// Two ways a file can arrive, sharing every rule below:
//   disk driver: one multipart request through multer (uploadDocument)
//   blob driver: the browser uploads straight to Vercel Blob with a token we
//                issue (blobUploadToken), then asks us to check and record it
//                (confirmBlobUpload). Vercel functions reject request bodies
//                over 4.5 MB, so a 5 MB file can't come through the API there.

// Reads only the first few bytes: enough for the magic-number check without
// loading a 5 MB file into memory.
async function readHeader(fullPath, length = 8) {
  const handle = await fs.open(fullPath, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

async function findMyApplication(userId) {
  return Application.findOne({ applicant: userId });
}

async function findMyDraftApplication(userId) {
  const application = await findMyApplication(userId);
  if (!application) {
    throw httpError(404, 'Start your application before uploading documents');
  }
  if (application.status !== APPLICATION_STATUS.DRAFT) {
    throw httpError(409, 'Documents can only be changed while the application is a Draft');
  }
  return application;
}

function assertDocumentType(documentType) {
  if (!DOCUMENT_TYPES.includes(documentType)) {
    throw httpError(400, `documentType must be one of: ${DOCUMENT_TYPES.join(', ')}`);
  }
}

// Records the outcome for one slot and replaces whatever was there before.
// The newest attempt is what the applicant sees and what submission checks.
async function saveUploadResult({ application, documentType, originalName, storedFileName, filePath, extension, sizeBytes, result }) {
  const previous = await Document.findOne({ application: application._id, documentType });

  const document = await Document.findOneAndUpdate(
    { application: application._id, documentType },
    {
      $set: {
        originalName,
        storedFileName: result.valid ? storedFileName : null,
        filePath: result.valid ? filePath : null,
        mimeType: mimeTypeFor(extension),
        sizeBytes,
        validationStatus: result.valid ? 'Valid' : 'Invalid',
        validationMessage: result.valid ? null : result.message,
      },
    },
    { upsert: true, returnDocument: 'after', runValidators: true }
  );

  // Only now that the database points at the new state is the old file
  // deleted. (Skip it if the "new" file is the same one, e.g. a repeated confirm.)
  if (previous?.filePath && previous.filePath !== document.filePath) {
    await storage.removeStoredFile(previous.filePath);
  }
  return document;
}

// POST /api/applications/me/documents   (disk driver; multipart: file, documentType)
async function uploadDocument(req, res) {
  // multer has already written the file (if any) by the time we get here.
  // From this point, every path that rejects the upload must delete it.
  const uploadedPath = req.file?.path;
  const removeUpload = () => (uploadedPath ? fs.rm(uploadedPath, { force: true }) : undefined);

  try {
    const application = await findMyDraftApplication(req.user.id);
    const { documentType } = req.body;
    assertDocumentType(documentType);
    if (!req.file) {
      throw httpError(400, 'No file uploaded. Choose a file and send it in the field named "file"');
    }

    // Size = bytes multer actually wrote to disk, never a client-declared value.
    const extension = normaliseExtension(path.extname(req.file.originalname));
    const result = validateDocument({
      extension,
      sizeBytes: req.file.size,
      isReadable: req.file.size > 0 && hasValidSignature(await readHeader(uploadedPath), extension),
    });
    if (!result.valid) await removeUpload();

    const document = await saveUploadResult({
      application,
      documentType,
      originalName: req.file.originalname,
      storedFileName: req.file.filename,
      filePath: path.relative(env.backendRoot, uploadedPath),
      extension,
      sizeBytes: req.file.size,
      result,
    });

    if (!result.valid) {
      return res.status(400).json({ error: result.message, document });
    }
    res.status(201).json({ document });
  } catch (err) {
    await removeUpload();
    throw err;
  }
}

// Blob pathnames are chosen by the browser but must have exactly this shape,
// with the caller's OWN application id in it. That's what ties an upload to
// its owner: nobody can get a token for, or confirm, someone else's folder.
// The file name part is a random UUID, never the user's file name.
function parseBlobPathname(pathname, applicationId) {
  const match = /^applications\/([0-9a-f]{24})\/[0-9a-f-]{36}\.([a-z0-9]{1,5})$/.exec(String(pathname));
  if (!match || match[1] !== applicationId.toString()) {
    throw httpError(400, 'This upload does not belong to your application');
  }
  return match[2]; // the extension
}

// POST /api/applications/me/documents/blob-token   (blob driver)
// Called by the browser's @vercel/blob upload(). Rule DU's first check (type)
// happens here, before any bytes are sent; the second (size) is enforced by
// Vercel Blob itself through maximumSizeInBytes in the signed token.
async function blobUploadToken(req, res) {
  const { handleUpload } = require('@vercel/blob/client');

  const response = await handleUpload({
    request: req,
    body: req.body,
    onBeforeGenerateToken: async (pathname, clientPayload) => {
      const application = await findMyDraftApplication(req.user.id);
      let payload;
      try {
        payload = JSON.parse(clientPayload ?? '{}');
      } catch {
        throw httpError(400, 'Invalid upload request');
      }
      const { documentType, originalName } = payload;
      assertDocumentType(documentType);
      const extension = parseBlobPathname(pathname, application._id);

      if (!isAllowedType(extension)) {
        // Record the rejection like a disk upload would, so the page can show
        // the exact message (the Blob SDK hides our error text from the browser).
        await saveUploadResult({
          application,
          documentType,
          originalName: String(originalName || `file.${extension}`).slice(0, 255),
          extension,
          sizeBytes: null, // nothing was uploaded
          result: { valid: false, message: MESSAGES.INVALID_TYPE },
        });
        throw httpError(400, MESSAGES.INVALID_TYPE);
      }

      return {
        maximumSizeInBytes: MAX_BYTES, // Blob refuses anything over 5,242,880 bytes
        addRandomSuffix: false, // the pathname we just checked is the one stored
        allowOverwrite: false,
        validUntil: Date.now() + 10 * 60 * 1000,
      };
    },
  });
  res.json(response);
}

// POST /api/applications/me/documents/blob   (blob driver)
// { documentType, pathname, originalName } after the browser finished uploading.
async function confirmBlobUpload(req, res) {
  const { documentType, pathname, originalName } = req.body;
  const application = await findMyApplication(req.user.id);
  if (!application) {
    throw httpError(404, 'Start your application before uploading documents');
  }
  const extension = parseBlobPathname(pathname, application._id);
  const reference = storage.BLOB_PREFIX + pathname;

  if (application.status !== APPLICATION_STATUS.DRAFT) {
    await storage.removeStoredFile(reference); // never keep files we won't record
    throw httpError(409, 'Documents can only be changed while the application is a Draft');
  }

  // Size and content come from Blob storage, never from the browser.
  const blob = await storage.headBlob(pathname);
  if (!blob) {
    throw httpError(400, 'Upload not found. Please upload the file again');
  }
  const result = validateDocument({
    extension,
    sizeBytes: blob.size,
    isReadable: blob.size > 0 && hasValidSignature(await storage.readBlobHeader(pathname), extension),
  });
  if (!result.valid) await storage.removeStoredFile(reference);

  const document = await saveUploadResult({
    application,
    documentType,
    originalName,
    storedFileName: path.posix.basename(pathname),
    filePath: reference,
    extension,
    sizeBytes: blob.size,
    result,
  });

  if (!result.valid) {
    return res.status(400).json({ error: result.message, document });
  }
  res.status(201).json({ document });
}

// GET /api/applications/me/documents
async function listMyDocuments(req, res) {
  const application = await findMyApplication(req.user.id);
  if (!application) {
    throw httpError(404, 'You have not started an application yet');
  }
  const documents = await Document.find({ application: application._id }).sort({ documentType: 1 });
  res.json({ documents, requiredTypes: REQUIRED_DOCUMENT_TYPES });
}

module.exports = { uploadDocument, blobUploadToken, confirmBlobUpload, listMyDocuments };
