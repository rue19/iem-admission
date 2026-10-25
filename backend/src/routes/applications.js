const express = require('express');
const { verifyToken } = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const validate = require('../middleware/validate');
const { ROLES } = require('../config/constants');
const {
  createApplicationSchema,
  updateApplicationSchema,
} = require('../validators/applicationSchemas');
const {
  createApplication,
  getMyApplication,
  updateMyApplication,
  submitMyApplication,
} = require('../controllers/applicationController');
const {
  uploadDocument,
  blobUploadToken,
  confirmBlobUpload,
  listMyDocuments,
} = require('../controllers/documentController');
const { blobConfirmSchema } = require('../validators/documentSchemas');
const env = require('../config/env');
const { uploadSingleFile } = require('../middleware/upload');

const router = express.Router();

// Applies to every route below: must be logged in AND be an applicant.
// Admins manage applications through /api/admin instead (Phase 5).
router.use(verifyToken, requireRole(ROLES.APPLICANT));

router.post('/', validate(createApplicationSchema), createApplication);
router.get('/me', getMyApplication);
router.put('/me', validate(updateApplicationSchema), updateMyApplication);

if (env.storageDriver === 'blob') {
  // Vercel: the browser uploads to Blob with a token from here, then confirms.
  router.post('/me/documents/blob-token', blobUploadToken);
  router.post('/me/documents/blob', validate(blobConfirmSchema), confirmBlobUpload);
} else {
  // Local disk: multer runs only AFTER the token and role checks above, so an
  // anonymous client can't make the server write files to disk.
  router.post('/me/documents', uploadSingleFile, uploadDocument);
}
router.get('/me/documents', listMyDocuments);

// No body is read: everything needed is already on the server.
router.post('/me/submit', submitMyApplication);

module.exports = router;
