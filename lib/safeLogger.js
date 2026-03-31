/**
 * Sanitized logger that strips sensitive patterns from error output.
 * Prevents API keys, tokens, and credentials from leaking into logs.
 */

const SENSITIVE_PATTERNS = [
  // API keys
  /sk-[a-zA-Z0-9]{20,}/g,
  /key-[a-zA-Z0-9]{20,}/g,
  // Bearer tokens
  /Bearer\s+[a-zA-Z0-9._\-]+/gi,
  // Generic long hex/base64 secrets
  /(?:api[_-]?key|secret|token|password|credential|authorization)\s*[:=]\s*['"]?[a-zA-Z0-9/+=._\-]{16,}['"]?/gi,
];

function sanitize(value) {
  if (typeof value !== 'string') return value;
  let result = value;
  for (const pattern of SENSITIVE_PATTERNS) {
    result = result.replace(pattern, '[REDACTED]');
  }
  return result;
}

function sanitizeObject(obj) {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') return sanitize(obj);
  if (obj instanceof Error) {
    return {
      message: sanitize(obj.message),
      name: obj.name,
      ...(obj.status && { status: obj.status }),
    };
  }
  if (typeof obj === 'object') {
    const result = {};
    for (const [key, val] of Object.entries(obj)) {
      const lowerKey = key.toLowerCase();
      if (
        lowerKey.includes('key') ||
        lowerKey.includes('secret') ||
        lowerKey.includes('token') ||
        lowerKey.includes('password') ||
        lowerKey.includes('authorization')
      ) {
        result[key] = '[REDACTED]';
      } else if (typeof val === 'string') {
        result[key] = sanitize(val);
      } else {
        result[key] = val;
      }
    }
    return result;
  }
  return obj;
}

/**
 * Log an error with sensitive data redacted.
 * @param {string} context - Description of where the error occurred
 * @param  {...any} args - Values to log (strings, Error objects, plain objects)
 */
export function safeError(context, ...args) {
  const sanitizedArgs = args.map(sanitizeObject);
  console.error(context, ...sanitizedArgs);
}

/**
 * Log a warning with sensitive data redacted.
 */
export function safeWarn(context, ...args) {
  const sanitizedArgs = args.map(sanitizeObject);
  console.warn(context, ...sanitizedArgs);
}
