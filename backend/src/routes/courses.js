const express = require('express');
const { verifyToken } = require('../middleware/auth');
const { listCourses } = require('../controllers/courseController');

const router = express.Router();

// Any logged-in user (applicant or admin) may read the catalogue.
router.get('/', verifyToken, listCourses);

module.exports = router;
