// Vercel entry point. Vercel runs this file as a serverless function for every
// request under /api (see vercel.json); the Express app does the rest.
//
// Locally, backend/src/server.js connects first and then listens. A serverless
// function has no "start", so it connects on the first request instead and
// keeps the connection for later requests while the function stays warm.
const app = require('../backend/src/app');
const env = require('../backend/src/config/env');
const { connectDB } = require('../backend/src/config/db');

let connecting = null;

module.exports = async (req, res) => {
  try {
    connecting ??= connectDB(env.mongoUri);
    await connecting;
  } catch (err) {
    connecting = null; // try again on the next request
    console.error('MongoDB connection failed:', err.message);
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ error: 'Database unavailable, please try again shortly' }));
  }
  return app(req, res);
};
