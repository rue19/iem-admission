const fs = require('fs/promises');
const path = require('path');
const env = require('../config/env');
const Application = require('../models/Application');
const Document = require('../models/Document');
const { DOCUMENT_TYPES, REQUIRED_DOCUMENT_TYPES } = require('../models/Document');
const { APPLICATION_STATUS } = require('../config/constants');
const {
  validateDocument,
  hasValidSignature,
  normaliseExtension,
  mimeTypeFor,
} = require('../services/documentValidation');
const httpError = require('../utils/httpError');

// Deletes a file and ignores "already gone", so cleanup never crashes a request.
async function removeFile(fullPath) {
  if (!fullPath) return;
  await fs.rm(fullPath, { force: true });
}

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

// POST /api/applications/me/documents   (multipart: file, documentType)
async function uploadDocument(req, res) {
  // multer has already written the file (if any) by the time we get here.
  // From this point, every path that rejects the upload must delete it.
  const uploadedPath = req.file?.path;

  try {
    const application = await findMyApplication(req.user.id);
    if (!application) {
      throw httpError(404, 'Start your application before uploading documents');
    }
    if (application.status !== APPLICATION_STATUS.DRAFT) {
      throw httpError(409, 'Documents can only be changed while the application is a Draft');
    }

    const { documentType } = req.body;
    if (!DOCUMENT_TYPES.includes(documentType)) {
      throw httpError(400, `documentType must be one of: ${DOCUMENT_TYPES.join(', ')}`);
    }
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

    // The previous upload in this slot (if any) is replaced either way: the
    // newest attempt is what the applicant sees and what submission checks.
    const previous = await Document.findOne({ application: application._id, documentType });

    if (!result.valid) {
      await removeFile(uploadedPath);
    }

    const document = await Document.findOneAndUpdate(
      { application: application._id, documentType },
      {
        $set: {
          originalName: req.file.originalname,
          storedFileName: result.valid ? req.file.filename : null,
          filePath: result.valid ? path.relative(env.backendRoot, uploadedPath) : null,
          mimeType: mimeTypeFor(extension),
          sizeBytes: req.file.size,
          validationStatus: result.valid ? 'Valid' : 'Invalid',
          validationMessage: result.valid ? null : result.message,
        },
      },
      { upsert: true, returnDocument: 'after', runValidators: true }
    );

    // Only now that the database points at the new file is the old one deleted.
    if (previous?.filePath) {
      await removeFile(path.resolve(env.backendRoot, previous.filePath));
    }

    if (!result.valid) {
      return res.status(400).json({ error: result.message, document });
    }
    res.status(201).json({ document });
  } catch (err) {
    await removeFile(uploadedPath);
    throw err;
  }
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

module.exports = { uploadDocument, listMyDocuments };
