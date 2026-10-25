const express = require('express');
const env = require('../config/env');
const { MAX_BYTES } = require('../services/documentValidation');

const router = express.Router();

// Public, non-secret settings the Angular app needs at runtime, so the same
// build works locally (disk uploads) and on Vercel (Blob uploads).
router.get('/', (req, res) => {
  res.json({ uploadMode: env.storageDriver, maxUploadBytes: MAX_BYTES });
});

module.exports = router;
