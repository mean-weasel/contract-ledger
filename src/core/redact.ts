const SECRET_KEYS = new Set([
  'api-key',
  'apikey',
  'auth',
  'authorization',
  'cookie',
  'password',
  'secret',
  'storage-state',
  'token',
]);

const REDACTED = '[REDACTED]';

function normalizeKey(key: string): string {
  return key.replace(/^-+/, '').toLowerCase();
}

function isSecretKey(key: string): boolean {
  return SECRET_KEYS.has(normalizeKey(key));
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
