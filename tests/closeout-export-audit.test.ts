import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  acceptContract,
  addCriterion,
  addFailureMode,
  addReceipt,
  addVerifier,
  closeContract,
  createContract,
  exportContractMarkdown,
  getContract,
  openLedger,
  resolveFailureMode,
  weakCloseoutReport,
} from '../src/index.js';

async function withTempWorkspace<T>(fn: (root: string) => T | Promise<T>): Promise<T> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'contract-closeout-'));

  try {
    return await fn(root);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
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

function satisfyCriterion(ledger: ReturnType<typeof openLedger>, criterionId: string): void {
  ledger.db.prepare("update criteria set status = 'satisfied' where id = ?").run(criterionId);
}

function deferCriterion(
  ledger: ReturnType<typeof openLedger>,
  criterionId: string,
  input?: {
    rationale?: string;
    residualRisk?: string;
  },
): void {
  ledger.db
    .prepare(
      `
      update criteria
      set
        status = 'deferred',
        rationale = @rationale,
        residual_risk = @residualRisk
      where id = @id
    `,
    )
    .run({
      id: criterionId,
      rationale: input?.rationale ?? null,
      residualRisk: input?.residualRisk ?? null,
    });
}

function artificiallyCloseContract(ledger: ReturnType<typeof openLedger>, contractId: string): void {
  ledger.db
    .prepare(
      `
      update contracts
      set status = 'closed', closed_at = '2026-06-11T00:00:00.000Z'
      where id = ?
    `,
    )
    .run(contractId);
}

describe('closeout gates exports and audit reports', () => {
  it('blocks draft contract closeout and records no contract_closed', async () => {
    await withTempWorkspace((root) => {
      const ledger = openLedger({ cwd: root });

      try {
        const contract = createContract(ledger, {
          title: 'Draft closeout contract',
          createdBy: 'test-agent',
        });

        const result = closeContract(ledger, {
          contractId: contract.id,
          actor: 'test-agent',
        });

        expect(result.ok).toBe(false);
        expect(result.problems.join('\n')).toMatch(/accepted or active/i);
        expect(eventTypes(ledger, contract.id)).toContain('closeout_attempted');
        expect(eventTypes(ledger, contract.id)).not.toContain('contract_closed');
      } finally {
        ledger.close();
      }
    });
  });

  it('blocks closeout when criteria are pending and mentions pending criteria', async () => {
    await withTempWorkspace((root) => {
      const ledger = openLedger({ cwd: root });

      try {
        const contract = createContract(ledger, {
          title: 'Pending criterion contract',
          createdBy: 'test-agent',
        });
        acceptContract(ledger, {
          contractId: contract.id,
          actor: 'test-agent',
        });
        addCriterion(ledger, {
          contractId: contract.id,
          statement: 'Criterion must be satisfied.',
          requiredEvidenceKind: 'manual',
          actor: 'test-agent',
        });

        const result = closeContract(ledger, {
          contractId: contract.id,
          actor: 'test-agent',
        });

        expect(result.ok).toBe(false);
        expect(result.problems.join('\n')).toMatch(/pending criteria/i);
        expect(eventTypes(ledger, contract.id)).toContain('closeout_attempted');
        expect(eventTypes(ledger, contract.id)).not.toContain('contract_closed');
      } finally {
        ledger.close();
      }
    });
  });

  it('blocks satisfied criteria without at least one passing receipt', async () => {
    await withTempWorkspace((root) => {
      const ledger = openLedger({ cwd: root });

      try {
        const contract = createContract(ledger, {
          title: 'Missing passing receipt contract',
          createdBy: 'test-agent',
        });
        acceptContract(ledger, {
          contractId: contract.id,
          actor: 'test-agent',
        });
        const criterion = addCriterion(ledger, {
          contractId: contract.id,
          statement: 'Criterion has proof.',
          requiredEvidenceKind: 'manual',
          actor: 'test-agent',
        });
        satisfyCriterion(ledger, criterion.id);
        addReceipt(ledger, {
          contractId: contract.id,
          criterionId: criterion.id,
          kind: 'manual',
          status: 'fail',
          summary: 'This does not prove the criterion.',
          actor: 'test-agent',
        });

        const result = closeContract(ledger, {
          contractId: contract.id,
          actor: 'test-agent',
        });

        expect(result.ok).toBe(false);
        expect(result.problems.join('\n')).toMatch(/passing receipt/i);
        expect(eventTypes(ledger, contract.id)).not.toContain('contract_closed');
      } finally {
        ledger.close();
      }
    });
  });

  it('blocks required failure modes still pending', async () => {
    await withTempWorkspace((root) => {
      const ledger = openLedger({ cwd: root });

      try {
        const contract = createContract(ledger, {
          title: 'Pending failure mode contract',
          createdBy: 'test-agent',
        });
        acceptContract(ledger, {
          contractId: contract.id,
          actor: 'test-agent',
        });
        const criterion = addCriterion(ledger, {
          contractId: contract.id,
          statement: 'Criterion has proof.',
          requiredEvidenceKind: 'manual',
          actor: 'test-agent',
        });
        satisfyCriterion(ledger, criterion.id);
        addReceipt(ledger, {
          contractId: contract.id,
          criterionId: criterion.id,
          kind: 'manual',
          status: 'pass',
          summary: 'Criterion proof passed.',
          actor: 'test-agent',
        });
        addFailureMode(ledger, {
          contractId: contract.id,
          failureMode: 'The proof checks the wrong thing',
          whyPlausible: 'Manual proof can drift from the criterion.',
          linkedCriterionId: criterion.id,
          checkDescription: 'Review proof alignment.',
          expectedProof: { reviewed: true },
          resolutionRule: 'Resolve before closeout.',
          required: true,
          actor: 'test-agent',
        });

        const result = closeContract(ledger, {
          contractId: contract.id,
          actor: 'test-agent',
        });

        expect(result.ok).toBe(false);
        expect(result.problems.join('\n')).toMatch(/required failure modes/i);
        expect(eventTypes(ledger, contract.id)).not.toContain('contract_closed');
      } finally {
        ledger.close();
      }
    });
  });

  it('succeeds when satisfied criteria have passing receipts and required failure modes are resolved', async () => {
    await withTempWorkspace((root) => {
      const ledger = openLedger({ cwd: root });

      try {
        const contract = createContract(ledger, {
          title: 'Clean closeout contract',
          createdBy: 'test-agent',
        });
        acceptContract(ledger, {
          contractId: contract.id,
          actor: 'test-agent',
        });
        const criterion = addCriterion(ledger, {
          contractId: contract.id,
          statement: 'Criterion has proof.',
          requiredEvidenceKind: 'manual',
          actor: 'test-agent',
        });
        satisfyCriterion(ledger, criterion.id);
        addReceipt(ledger, {
          contractId: contract.id,
          criterionId: criterion.id,
          kind: 'manual',
          status: 'pass',
          summary: 'Criterion proof passed.',
          actor: 'test-agent',
        });
        const failureMode = addFailureMode(ledger, {
          contractId: contract.id,
          failureMode: 'The proof checks the wrong thing',
          whyPlausible: 'Manual proof can drift from the criterion.',
          linkedCriterionId: criterion.id,
          checkDescription: 'Review proof alignment.',
          expectedProof: { reviewed: true },
          resolutionRule: 'Resolve before closeout.',
          required: true,
          actor: 'test-agent',
        });
        resolveFailureMode(ledger, {
          id: failureMode.id,
          status: 'ruled_out',
          actor: 'test-agent',
        });

        const result = closeContract(ledger, {
          contractId: contract.id,
          actor: 'test-agent',
        });

        expect(result).toEqual({ ok: true, problems: [] });
      } finally {
        ledger.close();
      }
    });
  });

  it('blocks deferred or rejected criteria without rationale and residual risk', async () => {
    await withTempWorkspace((root) => {
      const ledger = openLedger({ cwd: root });

      try {
        const contract = createContract(ledger, {
          title: 'Deferred criterion closeout contract',
          createdBy: 'test-agent',
        });
        acceptContract(ledger, {
          contractId: contract.id,
          actor: 'test-agent',
        });
        const criterion = addCriterion(ledger, {
          contractId: contract.id,
          statement: 'Criterion is deferred.',
          requiredEvidenceKind: 'manual',
          actor: 'test-agent',
        });
        deferCriterion(ledger, criterion.id, {
          rationale: '   ',
          residualRisk: '',
        });

        const result = closeContract(ledger, {
          contractId: contract.id,
          actor: 'test-agent',
        });

        expect(result.ok).toBe(false);
        expect(result.problems.join('\n')).toMatch(/rationale and residual risk/i);
        expect(eventTypes(ledger, contract.id)).not.toContain('contract_closed');
      } finally {
        ledger.close();
      }
    });
  });

  it('blocks required verifiers without a passing verifier receipt', async () => {
    await withTempWorkspace((root) => {
      const ledger = openLedger({ cwd: root });

      try {
        const contract = createContract(ledger, {
          title: 'Required verifier closeout contract',
          createdBy: 'test-agent',
        });
        acceptContract(ledger, {
          contractId: contract.id,
          actor: 'test-agent',
        });
        const criterion = addCriterion(ledger, {
          contractId: contract.id,
          statement: 'Criterion has criterion proof only.',
          requiredEvidenceKind: 'manual',
          actor: 'test-agent',
        });
        satisfyCriterion(ledger, criterion.id);
        const verifier = addVerifier(ledger, {
          contractId: contract.id,
          criterionId: criterion.id,
          adapterId: 'adp_command_builtin',
          name: 'Required command proof',
          kind: 'command',
          config: { command: 'node --version' },
          required: true,
          actor: 'test-agent',
        });
        addReceipt(ledger, {
          contractId: contract.id,
          criterionId: criterion.id,
          kind: 'manual',
          status: 'pass',
          summary: 'Criterion proof passed but is not linked to verifier.',
          actor: 'test-agent',
        });

        const result = closeContract(ledger, {
          contractId: contract.id,
          actor: 'test-agent',
        });

        expect(result.ok).toBe(false);
        expect(result.problems.join('\n')).toMatch(/required verifiers/i);
        expect(result.problems.join('\n')).toContain(verifier.id);
        expect(eventTypes(ledger, contract.id)).not.toContain('contract_closed');
      } finally {
        ledger.close();
      }
    });
  });

  it('allows closeout when required verifier has a passing verifier receipt', async () => {
    await withTempWorkspace((root) => {
      const ledger = openLedger({ cwd: root });

      try {
        const contract = createContract(ledger, {
          title: 'Required verifier proven contract',
          createdBy: 'test-agent',
        });
        acceptContract(ledger, {
          contractId: contract.id,
          actor: 'test-agent',
        });
        const criterion = addCriterion(ledger, {
          contractId: contract.id,
          statement: 'Criterion has verifier proof.',
          requiredEvidenceKind: 'command',
          actor: 'test-agent',
        });
        satisfyCriterion(ledger, criterion.id);
        const verifier = addVerifier(ledger, {
          contractId: contract.id,
          criterionId: criterion.id,
          adapterId: 'adp_command_builtin',
          name: 'Required command proof',
          kind: 'command',
          config: { command: 'node --version' },
          required: true,
          actor: 'test-agent',
        });
        addReceipt(ledger, {
          contractId: contract.id,
          criterionId: criterion.id,
          verifierId: verifier.id,
          kind: 'command',
          status: 'pass',
          summary: 'Verifier proof passed.',
          actor: 'test-agent',
        });

        const result = closeContract(ledger, {
          contractId: contract.id,
          actor: 'test-agent',
        });

        expect(result).toEqual({ ok: true, problems: [] });
        expect(eventTypes(ledger, contract.id)).toContain('contract_closed');
      } finally {
        ledger.close();
      }
    });
  });

  it('successful close updates contract status to closed and records contract_closed', async () => {
    await withTempWorkspace((root) => {
      const ledger = openLedger({ cwd: root });

      try {
        const contract = createContract(ledger, {
          title: 'Status closeout contract',
          createdBy: 'test-agent',
        });
        acceptContract(ledger, {
          contractId: contract.id,
          actor: 'test-agent',
        });

        const result = closeContract(ledger, {
          contractId: contract.id,
          actor: 'test-agent',
        });

        expect(result.ok).toBe(true);
        expect(getContract(ledger, contract.id)?.status).toBe('closed');
        expect(eventTypes(ledger, contract.id)).toContain('contract_closed');
      } finally {
        ledger.close();
      }
    });
  });

  it('failed close records closeout_attempted but not contract_closed', async () => {
    await withTempWorkspace((root) => {
      const ledger = openLedger({ cwd: root });

      try {
        const contract = createContract(ledger, {
          title: 'Failed closeout event contract',
          createdBy: 'test-agent',
        });
        acceptContract(ledger, {
          contractId: contract.id,
          actor: 'test-agent',
        });
        addCriterion(ledger, {
          contractId: contract.id,
          statement: 'Criterion remains pending.',
          requiredEvidenceKind: 'manual',
          actor: 'test-agent',
        });

        const result = closeContract(ledger, {
          contractId: contract.id,
          actor: 'test-agent',
        });

        expect(result.ok).toBe(false);
        expect(eventTypes(ledger, contract.id)).toContain('closeout_attempted');
        expect(eventTypes(ledger, contract.id)).not.toContain('contract_closed');
      } finally {
        ledger.close();
      }
    });
  });

  it('throws for missing contract close without recording contract_closed', async () => {
    await withTempWorkspace((root) => {
      const ledger = openLedger({ cwd: root });
      const missingContractId = 'ctr_missing';

      try {
        expect(() =>
          closeContract(ledger, {
            contractId: missingContractId,
            actor: 'test-agent',
          }),
        ).toThrow(`Contract not found: ${missingContractId}`);

        expect(eventTypes(ledger, missingContractId)).not.toContain('contract_closed');
      } finally {
        ledger.close();
      }
    });
  });

  it('exports contract markdown with title id status criteria receipts and failure modes', async () => {
    await withTempWorkspace((root) => {
      const ledger = openLedger({ cwd: root });

      try {
        const contract = createContract(ledger, {
          title: 'Markdown closeout contract',
          createdBy: 'test-agent',
        });
        const criterion = addCriterion(ledger, {
          contractId: contract.id,
          statement: 'Markdown lists the criterion.',
          requiredEvidenceKind: 'manual',
          actor: 'test-agent',
        });
        addReceipt(ledger, {
          contractId: contract.id,
          criterionId: criterion.id,
          kind: 'manual',
          status: 'pass',
          summary: 'Markdown lists the receipt.',
          actor: 'test-agent',
        });
        addFailureMode(ledger, {
          contractId: contract.id,
          failureMode: 'Markdown omits failure modes',
          whyPlausible: 'Exports can miss related tables.',
          linkedCriterionId: criterion.id,
          checkDescription: 'Read the export.',
          expectedProof: { exported: true },
          resolutionRule: 'Include failure modes.',
          required: true,
          actor: 'test-agent',
        });

        const markdown = exportContractMarkdown(ledger, contract.id);

        expect(markdown).toContain('# Markdown closeout contract');
        expect(markdown).toContain(`ID: ${contract.id}`);
        expect(markdown).toContain('Status: draft');
        expect(markdown).toContain('## Criteria');
        expect(markdown).toContain('Markdown lists the criterion.');
        expect(markdown).toContain('## Receipts');
        expect(markdown).toContain('Markdown lists the receipt.');
        expect(markdown).toContain('## Failure Modes');
        expect(markdown).toContain('Markdown omits failure modes');
      } finally {
        ledger.close();
      }
    });
  });

  it('weakCloseoutReport returns header and none when clean', async () => {
    await withTempWorkspace((root) => {
      const ledger = openLedger({ cwd: root });

      try {
        const contract = createContract(ledger, {
          title: 'Clean audit contract',
          createdBy: 'test-agent',
        });
        acceptContract(ledger, {
          contractId: contract.id,
          actor: 'test-agent',
        });
        closeContract(ledger, {
          contractId: contract.id,
          actor: 'test-agent',
        });

        expect(weakCloseoutReport(ledger)).toBe('# Weak Closeout Report\n\n- None\n');
      } finally {
        ledger.close();
      }
    });
  });

  it('weakCloseoutReport identifies an artificially closed contract missing passing receipts', async () => {
    await withTempWorkspace((root) => {
      const ledger = openLedger({ cwd: root });

      try {
        const contract = createContract(ledger, {
          title: 'Artificially closed weak contract',
          createdBy: 'test-agent',
        });
        const criterion = addCriterion(ledger, {
          contractId: contract.id,
          statement: 'Satisfied without passing proof.',
          requiredEvidenceKind: 'manual',
          actor: 'test-agent',
        });
        satisfyCriterion(ledger, criterion.id);
        artificiallyCloseContract(ledger, contract.id);

        const report = weakCloseoutReport(ledger);

        expect(report).toContain('# Weak Closeout Report');
        expect(report).toContain('Artificially closed weak contract');
        expect(report).toContain(contract.id);
        expect(report).toMatch(/missing passing receipt/i);
        expect(report).toContain(criterion.id);
      } finally {
        ledger.close();
      }
    });
  });
});
