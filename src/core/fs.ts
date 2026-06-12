import { createHash } from 'node:crypto';
import { mkdir, readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export type WorkspacePaths = {
  root: string;
  contractsDir: string;
  ledgerPath: string;
  artifactsDir: string;
  exportsDir: string;
};

export type FileMetadata = {
  sizeBytes: number;
  sha256: string;
};

export function getWorkspacePaths(cwd: string): WorkspacePaths {
  const root = path.resolve(cwd);
  const contractsDir = path.join(root, '.contracts');

  return {
    root,
    contractsDir,
    ledgerPath: path.join(contractsDir, 'ledger.sqlite'),
    artifactsDir: path.join(contractsDir, 'artifacts'),
    exportsDir: path.join(contractsDir, 'exports'),
  };
}

export function getGlobalLedgerPaths(homeDir = os.homedir()): WorkspacePaths {
  const root = path.resolve(homeDir, '.contract-ledger');

  return {
    root,
    contractsDir: root,
    ledgerPath: path.join(root, 'ledger.sqlite'),
    artifactsDir: path.join(root, 'artifacts'),
    exportsDir: path.join(root, 'exports'),
  };
}

export function getExplicitLedgerPaths(ledgerPath: string): WorkspacePaths {
  const resolvedLedgerPath = path.resolve(ledgerPath);
  const root = path.dirname(resolvedLedgerPath);

  return {
    root,
    contractsDir: root,
    ledgerPath: resolvedLedgerPath,
    artifactsDir: path.join(root, 'artifacts'),
    exportsDir: path.join(root, 'exports'),
  };
}

export async function ensureWorkspace(paths: WorkspacePaths): Promise<void> {
  await Promise.all([
    mkdir(paths.contractsDir, { recursive: true }),
    mkdir(paths.artifactsDir, { recursive: true }),
    mkdir(paths.exportsDir, { recursive: true }),
  ]);
}

export async function fileMetadata(filePath: string): Promise<FileMetadata> {
  const [contents, stats] = await Promise.all([readFile(filePath), stat(filePath)]);

  return {
    sizeBytes: stats.size,
    sha256: createHash('sha256').update(contents).digest('hex'),
  };
}
