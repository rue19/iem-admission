const express = require('express');
const { verifyToken } = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const validate = require('../middleware/validate');
const { ROLES } = require('../config/constants');
const {
  listQuerySchema,
  statusBodySchema,
  entranceScoreBodySchema,
} = require('../validators/adminSchemas');
const {
  listApplications,
  getApplication,
  updateStatus,
  setEntranceScore,
  downloadDocument,
} = require('../controllers/adminController');

const router = express.Router();

// Every /api/admin/* route: logged in AND role "admin" (from the verified
// token). An applicant gets 403 here no matter what URL they try.
router.use(verifyToken, requireRole(ROLES.ADMIN));

router.get('/applications', validate(listQuerySchema, 'query'), listApplications);
router.get('/applications/:id', getApplication);
router.patch('/applications/:id/status', validate(statusBodySchema), updateStatus);
router.patch('/applications/:id/entrance-score', validate(entranceScoreBodySchema), setEntranceScore);
router.get('/documents/:id/file', downloadDocument);

module.exports = router;
