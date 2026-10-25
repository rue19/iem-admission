// Creates an Error that carries an HTTP status. Controllers `throw httpError(...)`
// and the central errorHandler turns it into a JSON response.
function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

module.exports = httpError;
