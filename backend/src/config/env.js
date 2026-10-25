// Loads .env once and exposes a single, validated config object.
// Every other file imports from here instead of reading process.env directly,
// so a missing setting fails loudly at startup rather than mid-request.
const path = require('path');
require('dotenv').config({ quiet: true }); // quiet: skip dotenv's startup banner

// backend/ folder; relative paths in .env are resolved from here, not from
// wherever `node` happened to be started.
const BACKEND_ROOT = path.resolve(__dirname, '..', '..');

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name} (see .env.example)`);
  }
  return value;
}

const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT) || 3000,
  mongoUri: required('MONGO_URI'),
  // Used from Phase 1 to sign login tokens. Required now so setup is done once.
  jwtSecret: required('JWT_SECRET'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '2h',
  // The only browser origin allowed to call this API (the Angular dev server).
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:4200',
  backendRoot: BACKEND_ROOT,
  // Where uploaded file bytes are written. MongoDB only stores a reference.
  uploadDir: path.resolve(BACKEND_ROOT, process.env.UPLOAD_DIR || 'uploads'),
};

module.exports = env;
