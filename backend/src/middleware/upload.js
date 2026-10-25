// multer setup for document uploads: where files go, what they're called, and
// how big they may be. Content checks happen afterwards in the controller,
// using services/documentValidation.js.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const env = require('../config/env');
const { MAX_BYTES, isAllowedType, normaliseExtension, tooLargeMessage } = require('../services/documentValidation');
const httpError = require('../utils/httpError');

fs.mkdirSync(env.uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: env.uploadDir,
  // A random name on disk, never the user's file name. A name like
  // "../../server.js" can't escape the upload folder or overwrite anything,
  // and two users uploading "marksheet.pdf" can't collide.
  filename(req, file, cb) {
    const ext = normaliseExtension(path.extname(file.originalname));
    cb(null, `${crypto.randomUUID()}.${isAllowedType(ext) ? ext : 'bin'}`);
  },
});

const multerSingle = multer({
  storage,
  limits: {
    // multer counts the bytes as they ARRIVE and stops at the limit, so the
    // client can't lie about the size and an oversized file is never fully
    // written. multer deletes the partial file itself.
    fileSize: MAX_BYTES,
    files: 1,
    fields: 5,
  },
}).single('file');

// Wraps multer so its errors become our standard { error } responses.
// multer also removes partly written files when an upload is aborted midway,
// so an interrupted upload leaves nothing behind.
function uploadSingleFile(req, res, next) {
  multerSingle(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') return next(httpError(400, tooLargeMessage(undefined)));
      if (err.code === 'LIMIT_UNEXPECTED_FILE') {
        return next(httpError(400, 'Upload exactly one file in the form field named "file"'));
      }
      return next(httpError(400, `Upload rejected: ${err.message}`));
    }
    next(err);
  });
}

module.exports = { uploadSingleFile };
