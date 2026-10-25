const express = require('express');
const { verifyToken } = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const { ROLES } = require('../config/constants');
const { getMyFee, payMyFee } = require('../controllers/feeController');

const router = express.Router();

router.use(verifyToken, requireRole(ROLES.APPLICANT));

router.get('/me', getMyFee);
router.post('/me/pay', payMyFee);

module.exports = router;
