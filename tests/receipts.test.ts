import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  addCriterion,
  addFailureMode,
  addReceipt,
  addTodo,
  addVerifier,
  attachArtifact,
  createContract,
  openLedger,
  runCommandReceipt,
} from '../src/index.js';

async function withTempWorkspace<T>(fn: (root: string) => T | Promise<T>): Promise<T> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'contract-receipts-'));

  try {
    return await fn(root);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

function countRows(ledger: ReturnType<typeof openLedger>, tableName: string): number {
  const row = ledger.db.prepare(`select count(*) as count from ${tableName}`).get() as {
    count: number;
  };
  return row.count;
}

function eventTypes(ledger: ReturnType<typeof openLedger>, contractId: string): string[] {
  const rows = ledger.db
    .prepare(
      `
      select event_type
      from events
      where contract_id = ?
      order by created_at, rowid
    `,
    )
    .all(contractId) as Array<{ event_type: string }>;

  return rows.map((row) => row.event_type);
}

function makeContractEvidence(ledger: ReturnType<typeof openLedger>) {
  const contract = createContract(ledger, {
    title: 'Receipt contract',
    createdBy: 'test-agent',
  });
  const criterion = addCriterion(ledger, {
    contractId: contract.id,
    statement: 'Command proof exists.',
    requiredEvidenceKind: 'command',
    actor: 'test-agent',
  });
  const todo = addTodo(ledger, {
    contractId: contract.id,
    title: 'Run command proof',
    linkedCriterionId: criterion.id,
    actor: 'test-agent',
  });
  const verifier = addVerifier(ledger, {
    contractId: contract.id,
    criterionId: criterion.id,
    adapterId: 'adp_command_builtin',
    name: 'Node proof',
    kind: 'command',
    config: { command: 'node --version' },
    required: true,
    actor: 'test-agent',
  });
  const failureMode = addFailureMode(ledger, {
    contractId: contract.id,
    failureMode: 'Command output is misleading',
    whyPlausible: 'The command could pass without checking the required path.',
    linkedCriterionId: criterion.id,
    checkDescription: 'Inspect the command output.',
    expectedVerifierId: verifier.id,
    expectedProof: { command: 'node --version' },
    resolutionRule: 'Fail if the command exits nonzero.',
    required: true,
    actor: 'test-agent',
  });

  return { contract, criterion, todo, verifier, failureMode };
}

describe('receipts', () => {
  it('records a manual receipt with same-contract optional links and receipt_created event', async () => {
    await withTempWorkspace((root) => {
      const ledger = openLedger({ cwd: root });

      try {
        const { contract, criterion, verifier, todo, failureMode } = makeContractEvidence(ledger);

        const receipt = addReceipt(ledger, {
          contractId: contract.id,
          kind: 'manual',
          status: 'pass',
          summary: 'Reviewed the verification output.',
          criterionId: criterion.id,
          verifierId: verifier.id,
          todoId: todo.id,
          failureModeId: failureMode.id,
          actor: 'test-agent',
        });

        expect(receipt.status).toBe('pass');

        const stored = ledger.db
          .prepare(
            `
            select
              contract_id,
              kind,
              status,
              summary,
              criterion_id,
              verifier_id,
              todo_id,
              disproof_attempt_id,
              created_by
            from receipts
            where id = ?
          `,
          )
          .get(receipt.id) as {
          contract_id: string;
          kind: string;
          status: string;
          summary: string;
          criterion_id: string;
          verifier_id: string;
          todo_id: string;
          disproof_attempt_id: string;
          created_by: string;
        };

        expect(stored).toEqual({
          contract_id: contract.id,
          kind: 'manual',
          status: 'pass',
          summary: 'Reviewed the verification output.',
          criterion_id: criterion.id,
          verifier_id: verifier.id,
          todo_id: todo.id,
          disproof_attempt_id: failureMode.id,
          created_by: 'test-agent',
        });
        expect(eventTypes(ledger, contract.id)).toContain('receipt_created');
      } finally {
        ledger.close();
      }
    });
  });

  it('rejects invalid receipt status before recording a row or event', async () => {
    await withTempWorkspace((root) => {
      const ledger = openLedger({ cwd: root });

      try {
        const { contract } = makeContractEvidence(ledger);
        const receiptCount = countRows(ledger, 'receipts');
        const eventCount = countRows(ledger, 'events');

        expect(() =>
          addReceipt(ledger, {
            contractId: contract.id,
            kind: 'manual',
            status: 'pending' as 'pass',
            summary: 'Invalid status should not persist.',
            actor: 'test-agent',
          }),
        ).toThrow('Invalid receipt status: pending');

        expect(countRows(ledger, 'receipts')).toBe(receiptCount);
        expect(countRows(ledger, 'events')).toBe(eventCount);
      } finally {
        ledger.close();
      }
    });
  });

  it('requires JSON-safe adapter metadata and persists valid metadata', async () => {
    await withTempWorkspace((root) => {
      const ledger = openLedger({ cwd: root });

      try {
        const { contract } = makeContractEvidence(ledger);
        const receiptCount = countRows(ledger, 'receipts');
        const eventCount = countRows(ledger, 'events');

        expect(() =>
          addReceipt(ledger, {
            contractId: contract.id,
            kind: 'manual',
            status: 'inconclusive',
            summary: 'Invalid metadata should not persist.',
            adapterMetadata: { kept: true, dropped: undefined },
            actor: 'test-agent',
          }),
        ).toThrow('adapterMetadata must be JSON-serializable without lossy values');

        expect(countRows(ledger, 'receipts')).toBe(receiptCount);
        expect(countRows(ledger, 'events')).toBe(eventCount);

        const receipt = addReceipt(ledger, {
          contractId: contract.id,
          kind: 'manual',
          status: 'pass',
          summary: 'Valid metadata persists.',
          adapterMetadata: { score: 0.98, labels: ['fast', 'deterministic'], nested: { ok: true } },
          actor: 'test-agent',
        });

        const stored = ledger.db
          .prepare('select adapter_metadata_json from receipts where id = ?')
          .get(receipt.id) as { adapter_metadata_json: string };

        expect(JSON.parse(stored.adapter_metadata_json)).toEqual({
          score: 0.98,
          labels: ['fast', 'deterministic'],
          nested: { ok: true },
        });
      } finally {
        ledger.close();
      }
    });
  });

  it('attaches an artifact with file metadata, same-contract link, and artifact_attached event', async () => {
    await withTempWorkspace(async (root) => {
      const ledger = openLedger({ cwd: root });

      try {
        const { contract } = makeContractEvidence(ledger);
        const receipt = addReceipt(ledger, {
          contractId: contract.id,
          kind: 'manual',
          status: 'pass',
          summary: 'Attach proof file.',
          actor: 'test-agent',
        });
        const artifactPath = path.join(root, 'proof.txt');
        const artifactContents = 'receipt proof\n';
        await writeFile(artifactPath, artifactContents);

        const artifact = await attachArtifact(ledger, {
          contractId: contract.id,
          receiptId: receipt.id,
          path: artifactPath,
          mimeType: 'text/plain',
          actor: 'test-agent',
        });

        const expectedSha = createHash('sha256').update(artifactContents).digest('hex');
        expect(artifact.sha256).toBe(expectedSha);

        const stored = ledger.db
          .prepare(
            `
            select path, mime_type, size_bytes, sha256
            from artifacts
            where id = ?
          `,
          )
          .get(artifact.id) as {
          path: string;
          mime_type: string;
          size_bytes: number;
          sha256: string;
        };
        const link = ledger.db
          .prepare(
            `
            select receipt_id, artifact_id, contract_id
            from receipt_artifacts
            where receipt_id = ? and artifact_id = ?
          `,
          )
          .get(receipt.id, artifact.id) as {
          receipt_id: string;
          artifact_id: string;
          contract_id: string;
        };

        expect(stored).toEqual({
          path: path.resolve(artifactPath),
          mime_type: 'text/plain',
          size_bytes: artifactContents.length,
          sha256: expectedSha,
        });
        expect(link).toEqual({
          receipt_id: receipt.id,
          artifact_id: artifact.id,
          contract_id: contract.id,
        });
        expect(eventTypes(ledger, contract.id)).toContain('artifact_attached');
      } finally {
        ledger.close();
      }
    });
  });

  it('rejects artifact attachment for a receipt from another contract before recording artifact event', async () => {
    await withTempWorkspace(async (root) => {
      const ledger = openLedger({ cwd: root });

      try {
        const first = makeContractEvidence(ledger);
        const second = createContract(ledger, {
          title: 'Other receipt contract',
          createdBy: 'test-agent',
        });
        const receipt = addReceipt(ledger, {
          contractId: first.contract.id,
          kind: 'manual',
          status: 'pass',
          summary: 'Belongs to first contract.',
          actor: 'test-agent',
        });
        const artifactPath = path.join(root, 'wrong-contract.txt');
        await writeFile(artifactPath, 'wrong contract\n');
        const artifactCount = countRows(ledger, 'artifacts');

        await expect(
          attachArtifact(ledger, {
            contractId: second.id,
            receiptId: receipt.id,
            path: artifactPath,
            actor: 'test-agent',
          }),
        ).rejects.toThrow(`Receipt not found for contract: ${receipt.id}`);

        expect(countRows(ledger, 'artifacts')).toBe(artifactCount);
        expect(eventTypes(ledger, second.id)).not.toContain('artifact_attached');
      } finally {
        ledger.close();
      }
    });
  });

  it('runs a passing command receipt with excerpts and verifier run events', async () => {
    await withTempWorkspace(async (root) => {
      const ledger = openLedger({ cwd: root });

      try {
        const { contract, criterion, verifier } = makeContractEvidence(ledger);

        const receipt = await runCommandReceipt(ledger, {
          contractId: contract.id,
          criterionId: criterion.id,
          verifierId: verifier.id,
          command: process.execPath,
          args: ['-e', 'process.stdout.write("ok from command")'],
          actor: 'test-agent',
        });

        expect(receipt.status).toBe('pass');
        expect(receipt.stdoutExcerpt).toBe('ok from command');

        const stored = ledger.db
          .prepare(
            `
            select kind, status, command, exit_code, stdout_excerpt, stderr_excerpt
            from receipts
            where id = ?
          `,
          )
          .get(receipt.id) as {
          kind: string;
          status: string;
          command: string;
          exit_code: number;
          stdout_excerpt: string;
          stderr_excerpt: string;
        };

        expect(stored).toEqual({
          kind: 'command',
          status: 'pass',
          command: `${process.execPath} -e process.stdout.write("ok from command")`,
          exit_code: 0,
          stdout_excerpt: 'ok from command',
          stderr_excerpt: '',
        });
        expect(eventTypes(ledger, contract.id)).toEqual(
          expect.arrayContaining([
            'verifier_run_started',
            'receipt_created',
            'verifier_run_completed',
          ]),
        );
      } finally {
        ledger.close();
      }
    });
  });

  it('records a fail receipt and failed verifier event for a nonzero command', async () => {
    await withTempWorkspace(async (root) => {
      const ledger = openLedger({ cwd: root });

      try {
        const { contract, verifier } = makeContractEvidence(ledger);

        const receipt = await runCommandReceipt(ledger, {
          contractId: contract.id,
          verifierId: verifier.id,
          command: process.execPath,
          args: ['-e', 'process.stderr.write("bad command"); process.exit(7)'],
          actor: 'test-agent',
        });

        expect(receipt.status).toBe('fail');
        expect(receipt.stderrExcerpt).toBe('bad command');

        const stored = ledger.db
          .prepare('select status, exit_code, stderr_excerpt from receipts where id = ?')
          .get(receipt.id) as {
          status: string;
          exit_code: number;
          stderr_excerpt: string;
        };

        expect(stored).toEqual({
          status: 'fail',
          exit_code: 7,
          stderr_excerpt: 'bad command',
        });
        expect(eventTypes(ledger, contract.id)).toContain('verifier_run_failed');
      } finally {
        ledger.close();
      }
    });
  });
});
