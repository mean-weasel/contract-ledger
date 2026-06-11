import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { createProgram } from '../src/cli.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

describe('createProgram', () => {
  it('registers the contract CLI name', () => {
    const program = createProgram();
    expect(program.name()).toBe('contract');
  });

  it('prints the CLI version from the version command', async () => {
    const program = createProgram();
    let stdout = '';

    program.configureOutput({
      writeOut: (value) => {
        stdout += value;
      },
    });

    await program.parseAsync(['version'], { from: 'user' });

    expect(stdout).toBe('0.1.0\n');
  });

  it('runs the parser when invoked through a symlinked entrypoint', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'contract-cli-'));
    const symlinkPath = join(tempDir, 'contract.ts');

    try {
      symlinkSync(join(repoRoot, 'src', 'cli.ts'), symlinkPath);

      const result = spawnSync(
        process.execPath,
        ['--import', 'tsx', symlinkPath, 'version'],
        {
          cwd: repoRoot,
          encoding: 'utf8',
        },
      );

      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
      expect(result.stdout).toBe('0.1.0\n');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
