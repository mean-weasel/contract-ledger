const SECRET_TOKENS = new Set([
  'auth',
  'authorization',
  'apikey',
  'cookie',
  'key',
  'password',
  'secret',
  'token',
]);

const HEADER_OPTION_KEYS = new Set(['header', 'headers']);
const REDACTED = '[REDACTED]';

function normalizeKey(key: string): string {
  return key.replace(/^-+/, '').toLowerCase();
}

function isSecretKey(key: string): boolean {
  const normalized = normalizeKey(key);
  const segments = normalized.split(/[-_.:]+/);

  if (
    segments.some((segment, index) => segment === 'api' && segments[index + 1] === 'key') ||
    segments.some((segment, index) => segment === 'storage' && segments[index + 1] === 'state')
  ) {
    return true;
  }

  return segments.some((segment) => SECRET_TOKENS.has(segment));
}

function isHeaderOption(key: string): boolean {
  return key === '-H' || HEADER_OPTION_KEYS.has(normalizeKey(key));
}

function isSensitiveHeaderValue(value: string): boolean {
  return /^(authorization|proxy-authorization|cookie|set-cookie)\s*:/i.test(value.trim());
}

export function redactArgv(argv: string[]): string[] {
  const redacted: string[] = [];
  let redactNext = false;
  let maybeRedactHeaderNext = false;

  for (const arg of argv) {
    if (redactNext) {
      redacted.push(REDACTED);
      redactNext = false;
      continue;
    }

    if (maybeRedactHeaderNext) {
      redacted.push(isSensitiveHeaderValue(arg) ? REDACTED : arg);
      maybeRedactHeaderNext = false;
      continue;
    }

    if (isSensitiveHeaderValue(arg)) {
      redacted.push(REDACTED);
      continue;
    }

    if (arg.startsWith('--') || arg === '-H') {
      const equalsIndex = arg.indexOf('=');

      if (equalsIndex > -1) {
        const key = arg.slice(0, equalsIndex);
        const value = arg.slice(equalsIndex + 1);

        if (isSecretKey(key)) {
          redacted.push(`${key}=${REDACTED}`);
          continue;
        }

        if (isHeaderOption(key) && isSensitiveHeaderValue(value)) {
          redacted.push(`${key}=${REDACTED}`);
          continue;
        }
      } else if (isSecretKey(arg)) {
        redacted.push(arg);
        redactNext = true;
        continue;
      } else if (isHeaderOption(arg)) {
        redacted.push(arg);
        maybeRedactHeaderNext = true;
        continue;
      }
    }

    redacted.push(arg);
  }

  return redacted;
}
