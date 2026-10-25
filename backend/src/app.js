// Builds the Express app but does NOT start listening or connect to MongoDB.
// Keeping that separate (see server.js) lets tests import the app directly
// with supertest and point it at a test database.
const express = require('express');
const cors = require('cors');
const env = require('./config/env');
const healthRoutes = require('./routes/health');
const authRoutes = require('./routes/auth');
const courseRoutes = require('./routes/courses');
const applicationRoutes = require('./routes/applications');
const { notFound, errorHandler } = require('./middleware/errorHandler');

const app = express();

// Only the Angular app's origin may call the API from a browser.
app.use(cors({ origin: env.clientOrigin }));

// Parse JSON bodies; the small limit is fine because files go through multer,
// not JSON.
app.use(express.json({ limit: '100kb' }));

app.use('/api/health', healthRoutes);
// Public: register/login. verifyToken is applied per-route inside (only /me).
app.use('/api/auth', authRoutes);
// Protected: each router applies verifyToken (and requireRole) itself.
app.use('/api/courses', courseRoutes);
app.use('/api/applications', applicationRoutes);

// Must come after all routes.
app.use(notFound);
app.use(errorHandler);

module.exports = app;
