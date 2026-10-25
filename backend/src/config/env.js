// Loads .env once and exposes a single, validated config object.
// Every other file imports from here instead of reading process.env directly,
// so a missing setting fails loudly at startup rather than mid-request.
const path = require('path');
require('dotenv').config({ quiet: true }); // quiet: skip dotenv's startup banner

// backend/ folder; relative paths in .env are resolved from here, not from
// wherever `node` happened to be started.
const BACKEND_ROOT = path.resolve(__dirname, '..', '..');

// required('A', 'B') accepts the first of several names that is set.
function required(...names) {
  const value = names.map((name) => process.env[name]).find(Boolean);
  if (!value) {
    throw new Error(`Missing required environment variable: ${names.join(' or ')} (see .env.example)`);
  }
  return value;
}

const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT) || 3000,
  // MONGODB_URI is the name Vercel's MongoDB Atlas integration sets.
  mongoUri: required('MONGO_URI', 'MONGODB_URI'),
  // Used from Phase 1 to sign login tokens. Required now so setup is done once.
  jwtSecret: required('JWT_SECRET'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '2h',
  // The only browser origin allowed to call this API (the Angular dev server).
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:4200',
  backendRoot: BACKEND_ROOT,
  // Where uploaded file bytes are written. MongoDB only stores a reference.
  uploadDir: path.resolve(BACKEND_ROOT, process.env.UPLOAD_DIR || 'uploads'),
  // "disk": files go to uploadDir through multer (local development, tests).
  // "blob": files go to Vercel Blob (the Vercel deployment, which has no
  // lasting disk). See services/storage.js.
  storageDriver: storageDriver(),
};

function storageDriver() {
  const driver = process.env.STORAGE_DRIVER || 'disk';
  if (!['disk', 'blob'].includes(driver)) {
    throw new Error(`STORAGE_DRIVER must be "disk" or "blob", got "${driver}"`);
  }
  return driver;
}

module.exports = env;
