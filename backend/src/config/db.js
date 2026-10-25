const mongoose = require('mongoose');

// Reject queries on fields that are not in the schema, instead of silently
// ignoring them. Makes filter bugs visible early.
mongoose.set('strictQuery', true);

async function connectDB(uri) {
  await mongoose.connect(uri);
  if (process.env.NODE_ENV !== 'test') console.log(`MongoDB connected: ${mongoose.connection.host}/${mongoose.connection.name}`);
}

async function disconnectDB() {
  await mongoose.disconnect();
}

// Mongoose readyState: 0 disconnected, 1 connected, 2 connecting, 3 disconnecting.
function dbStatus() {
  const states = ['disconnected', 'connected', 'connecting', 'disconnecting'];
  return states[mongoose.connection.readyState] || 'unknown';
}

module.exports = { connectDB, disconnectDB, dbStatus };
