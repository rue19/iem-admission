// Use AFTER verifyToken: requireRole('admin') lets the request through only if
// the role inside the verified token matches.
// 401 = "we don't know who you are"; 403 = "we know, and you're not allowed".
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'You do not have permission to do this' });
    }
    next();
  };
}

module.exports = requireRole;
