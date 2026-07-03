const jwt = require('jsonwebtoken');

function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const token = header.split(' ')[1];

  // Try verifying as our own JWT first
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback_secret_dev');
    req.userId = decoded.userId;
    // Store token for creating user-scoped Supabase client
    req.supabaseToken = decoded.supabaseToken || null;
    req.rawToken = token;
    return next();
  } catch (err) {
    // Not our JWT — try as Supabase JWT
    try {
      // Decode without verifying to extract sub (userId)
      const decoded = jwt.decode(token);
      if (decoded && decoded.sub) {
        req.userId = decoded.sub;
        req.supabaseToken = token;
        req.rawToken = token;
        return next();
      }
    } catch {}
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

module.exports = auth;
