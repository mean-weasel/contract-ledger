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

export function redactArgv(argv: string[]): string[] {
  const redacted: string[] = [];
  let redactNext = false;

  for (const arg of argv) {
    if (redactNext) {
      redacted.push(REDACTED);
      redactNext = false;
      continue;
    }

    if (arg.startsWith('--')) {
      const equalsIndex = arg.indexOf('=');

      if (equalsIndex > -1) {
        const key = arg.slice(0, equalsIndex);

        if (isSecretKey(key)) {
          redacted.push(`${key}=${REDACTED}`);
          continue;
        }
      } else if (isSecretKey(arg)) {
        redacted.push(arg);
        redactNext = true;
        continue;
      }
    }

    redacted.push(arg);
  }

  return redacted;
}
