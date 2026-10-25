const jwt = require('jsonwebtoken');
const env = require('../config/env');

// Checks the "Authorization: Bearer <token>" header on every protected route.
// If the signature is valid and not expired, the token's { id, role } is put
// on req.user, which is the ONLY identity later code may trust (never an id
// or role sent in the body or URL).
function verifyToken(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    // Pinning the algorithm blocks tokens that claim a different (e.g. "none") algorithm.
    const payload = jwt.verify(token, env.jwtSecret, { algorithms: ['HS256'] });
    req.user = { id: payload.id, role: payload.role };
    next();
  } catch (err) {
    const message =
      err.name === 'TokenExpiredError' ? 'Session expired, please log in again' : 'Invalid token';
    return res.status(401).json({ error: message });
  }
}

module.exports = { verifyToken };
