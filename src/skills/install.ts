import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type InstallSkillInput = {
  targetDir?: string;
  overwrite?: boolean;
  sourceUrl?: string;
};

export type InstallSkillResult = {
  sourcePath: string;
  targetPath: string;
  installed: boolean;
};

function defaultTargetDir(): string {
  return path.join(os.homedir(), '.codex', 'skills', 'contract-ledger');
}

function sourceCandidates(sourceUrl: string): string[] {
  const here = path.dirname(fileURLToPath(sourceUrl));

  return [
    path.resolve(here, '..', 'skills', 'contract-ledger', 'SKILL.md'),
    path.resolve(here, '..', '..', 'skills', 'contract-ledger', 'SKILL.md'),
  ];
}

function findSkillSource(sourceUrl: string): string {
  const found = sourceCandidates(sourceUrl).find((candidate) => existsSync(candidate));

  if (found === undefined) {
    throw new Error('Bundled contract-ledger skill not found.');
  }

  return found;
}

export function installContractLedgerSkill(input: InstallSkillInput = {}): InstallSkillResult {
  const sourcePath = findSkillSource(input.sourceUrl ?? import.meta.url);
  const targetDir = input.targetDir ?? defaultTargetDir();
  const targetPath = path.join(targetDir, 'SKILL.md');

  if (existsSync(targetPath) && input.overwrite !== true) {
    return {
      sourcePath,
      targetPath,
      installed: false,
    };
  }

  mkdirSync(targetDir, { recursive: true });
  copyFileSync(sourcePath, targetPath);

  return {
    sourcePath,
    targetPath,
    installed: true,
  };
}
