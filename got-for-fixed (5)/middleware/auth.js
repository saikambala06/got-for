const jwt = require('jsonwebtoken');

function requireAuth(req, res, next) {
  // Accept the session either as an httpOnly cookie (web dashboard) or as a
  // Bearer token (browser extension, which cannot read httpOnly cookies and
  // instead stores the token in chrome.storage.local after login).
  let token = req.cookies && req.cookies.jt_token;
  if (!token) {
    const header = req.headers.authorization || '';
    if (header.startsWith('Bearer ')) token = header.slice(7).trim();
  }
  if (!token) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.id;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
}

module.exports = requireAuth;
