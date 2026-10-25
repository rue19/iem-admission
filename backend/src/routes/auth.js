const express = require('express');
const validate = require('../middleware/validate');
const { verifyToken } = require('../middleware/auth');
const { registerSchema, loginSchema } = require('../validators/authSchemas');
const { register, login, me } = require('../controllers/authController');

const router = express.Router();

// Express 5 forwards errors thrown in async handlers to errorHandler
// automatically, so no try/catch wrappers are needed in controllers.
router.post('/register', validate(registerSchema), register);
router.post('/login', validate(loginSchema), login);
router.get('/me', verifyToken, me);

module.exports = router;
