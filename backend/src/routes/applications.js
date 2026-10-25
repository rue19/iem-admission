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
} = require('../controllers/applicationController');

const router = express.Router();

// Applies to every route below: must be logged in AND be an applicant.
// Admins manage applications through /api/admin instead (Phase 5).
router.use(verifyToken, requireRole(ROLES.APPLICANT));

router.post('/', validate(createApplicationSchema), createApplication);
router.get('/me', getMyApplication);
router.put('/me', validate(updateApplicationSchema), updateMyApplication);

module.exports = router;
