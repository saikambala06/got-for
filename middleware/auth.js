const jwt = require('jsonwebtoken');
const { getJwtSecret, ConfigError, sendConfigError } = require('../utils/config');

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
  // Resolve the secret outside the verify try/catch. A misconfigured server
  // must not be reported as an expired session — that tells the user to log in
  // again, which cannot possibly work and hides the real fault.
  let secret;
  try {
    secret = getJwtSecret();
  } catch (err) {
    if (err instanceof ConfigError) return sendConfigError(res, err);
    throw err;
  }

  try {
    const decoded = jwt.verify(token, secret);
    req.userId = decoded.id;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
}

module.exports = requireAuth;
