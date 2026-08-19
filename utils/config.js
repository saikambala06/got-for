/**
 * Environment configuration and validation.
 *
 * A missing environment variable is a *deployment* problem, not a user
 * problem, and the two must never look the same. Before this existed, an
 * unset JWT_SECRET made `jwt.sign()` throw deep inside the login handler,
 * which the route caught and reported as "Could not log in. Please try
 * again." — advice that can never work, on a fault the user cannot fix and
 * the operator cannot see.
 *
 * Everything here fails loudly and specifically instead.
 */

'use strict';

/** Thrown when the server is misconfigured. Carries an actionable message. */
class ConfigError extends Error {
  constructor(message, hint = '', variable = '') {
    super(message);
    this.name = 'ConfigError';
    this.message = message;
    this.hint = hint;
    this.variable = variable;
    this.status = 503;
    this.code = 'server_misconfigured';
  }
}

const MIN_SECRET_LENGTH = 16;

/**
 * The secret used to sign and verify session tokens.
 * @throws {ConfigError} when unset or too weak to be safe.
 */
function getJwtSecret() {
  const secret = process.env.JWT_SECRET;

  if (!secret || !secret.trim()) {
    throw new ConfigError(
      'The server is not configured to issue sessions.',
      'JWT_SECRET is not set. Add it in Vercel → Project Settings → Environment ' +
        'Variables, then redeploy. Generate one with: ' +
        'node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"',
      'JWT_SECRET'
    );
  }

  if (secret.trim().length < MIN_SECRET_LENGTH) {
    throw new ConfigError(
      'The server\'s session secret is too short to be secure.',
      `JWT_SECRET must be at least ${MIN_SECRET_LENGTH} characters. Generate one with: ` +
        'node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"',
      'JWT_SECRET'
    );
  }

  return secret;
}

function getMongoUri() {
  const uri = process.env.MONGODB_URI;
  if (!uri || !uri.trim()) {
    throw new ConfigError(
      'The server is not configured to reach its database.',
      'MONGODB_URI is not set. Add it in Vercel → Project Settings → Environment Variables, then redeploy.',
      'MONGODB_URI'
    );
  }
  return uri;
}

/**
 * Report which settings are present, for diagnostics.
 *
 * Returns booleans and lengths only — never a value, so this is safe to
 * expose on an unauthenticated health endpoint.
 */
function status() {
  const secret = (process.env.JWT_SECRET || '').trim();
  const mongo = (process.env.MONGODB_URI || '').trim();
  const groq = (process.env.GROQ_API_KEY || '').trim();
  const groqPool = (process.env.GROQ_API_KEYS || '').trim();

  return {
    jwtSecret: {
      set: Boolean(secret),
      longEnough: secret.length >= MIN_SECRET_LENGTH,
      required: true
    },
    mongoUri: {
      set: Boolean(mongo),
      looksValid: /^mongodb(\+srv)?:\/\//i.test(mongo),
      required: true
    },
    groq: {
      set: Boolean(groq || groqPool),
      keyCount: groqPool ? groqPool.split(',').filter((k) => k.trim()).length : (groq ? 1 : 0),
      required: false,
      note: 'Optional. Used for tailoring and cover letters. Resume parsing does not use AI.'
    }
  };
}

/** The required settings that are missing or invalid, as variable names. */
function missingRequired() {
  const state = status();
  const missing = [];
  if (!state.jwtSecret.set || !state.jwtSecret.longEnough) missing.push('JWT_SECRET');
  if (!state.mongoUri.set) missing.push('MONGODB_URI');
  return missing;
}

/**
 * Express error handler for ConfigError.
 * Returns 503 (the server cannot serve this yet), never 500, and always says
 * which variable is at fault so it can be fixed without reading the source.
 */
function sendConfigError(res, err) {
  console.error(`[config] ${err.variable || 'configuration'}: ${err.message} — ${err.hint}`);
  return res.status(err.status || 503).json({
    error: err.message,
    hint: err.hint,
    code: err.code,
    missing: err.variable ? [err.variable] : missingRequired()
  });
}

module.exports = {
  ConfigError,
  getJwtSecret,
  getMongoUri,
  status,
  missingRequired,
  sendConfigError,
  MIN_SECRET_LENGTH
};
