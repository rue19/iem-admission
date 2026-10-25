const express = require('express');
const { dbStatus } = require('../config/db');

const router = express.Router();

// A cheap "is everything wired up?" check: proves Express answers and shows
// whether Mongoose is connected to MongoDB.
router.get('/', (req, res) => {
  const db = dbStatus();
  res.status(db === 'connected' ? 200 : 503).json({
    status: db === 'connected' ? 'ok' : 'degraded',
    db,
    time: new Date().toISOString(),
  });
});

module.exports = router;
