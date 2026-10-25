// Central error handling. Routes either throw or call next(err); everything
// ends up here so every error response has the same JSON shape: { error }.

// For requests that matched no route.
function notFound(req, res) {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.originalUrl}` });
}

// Express recognises an error handler by its 4 arguments, so `next` must stay
// in the signature even though it is unused.
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  // Malformed JSON body sent by the client.
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Request body is not valid JSON' });
  }

  // JSON body over the 100 KB limit set in app.js.
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request body is too large' });
  }

  // MongoDB unique index violation (e.g. two registrations with the same email
  // arriving at the same moment).
  if (err.code === 11000) {
    return res.status(409).json({ error: 'A record with this value already exists' });
  }

  // Mongoose rejected the data (schema rule) or an id was not a valid ObjectId.
  if (err.name === 'ValidationError' || err.name === 'CastError') {
    return res.status(400).json({ error: err.message });
  }

  const status = err.status || err.statusCode || 500;

  if (status >= 500) {
    console.error(err);
    // Never leak stack traces or internal details to the browser.
    return res.status(status).json({ error: 'Internal server error' });
  }

  res.status(status).json({ error: err.message });
}

module.exports = { notFound, errorHandler };
