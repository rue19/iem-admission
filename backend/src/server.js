// Entry point: connect to MongoDB first, then start accepting HTTP requests.
// Connecting first means the API never serves requests it cannot fulfil.
const app = require('./app');
const env = require('./config/env');
const { connectDB } = require('./config/db');

async function start() {
  try {
    await connectDB(env.mongoUri);
    app.listen(env.port, () => {
      console.log(`API listening on http://localhost:${env.port} (${env.nodeEnv})`);
    });
  } catch (err) {
    console.error('Failed to start server:', err.message);
    process.exit(1);
  }
}

start();
