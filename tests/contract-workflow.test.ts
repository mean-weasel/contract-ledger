import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  acceptContract,
  addCriterion,
  addTodo,
  addVerifier,
  createContract,
  listAdapters,
  listProfiles,
  openLedger,
} from '../src/index.js';

async function withTempWorkspace<T>(fn: (root: string) => T | Promise<T>): Promise<T> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'contract-workflow-'));

  try {
    return await fn(root);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

describe('contract workflow records', () => {
  it('creates a contract workflow with criteria todos verifiers adapters and profiles', async () => {
    await withTempWorkspace((root) => {
      const ledger = openLedger({ cwd: root });

      try {
        const contract = createContract(ledger, {
          title: 'Ship visual regression proof',
          intent: 'Verify the UI before release',
          scope: 'Dashboard smoke path',
          createdBy: 'test-agent',
        });

        expect(contract).toMatchObject({
          title: 'Ship visual regression proof',
          intent: 'Verify the UI before release',
          scope: 'Dashboard smoke path',
          status: 'draft',
        });

        const criterion = addCriterion(ledger, {
          contractId: contract.id,
          statement: 'The dashboard matches the reference capture.',
          requiredEvidenceKind: 'visual',
          priority: 10,
          actor: 'test-agent',
        });

        expect(criterion.status).toBe('pending');

        const todo = addTodo(ledger, {
          contractId: contract.id,
          title: 'Capture dashboard comparison',
          description: 'Run Limner on the dashboard route.',
          linkedCriterionId: criterion.id,
          actor: 'test-agent',
        });

        expect(todo.status).toBe('pending');

        const verifier = addVerifier(ledger, {
          contractId: contract.id,
          criterionId: criterion.id,
          adapterId: 'adp_command_builtin',
          name: 'Run smoke proof',
          kind: 'command',
          config: { command: 'npm test -- tests/contract-workflow.test.ts' },
          required: true,
          actor: 'test-agent',
        });

        expect(verifier.name).toBe('Run smoke proof');

        const accepted = acceptContract(ledger, {
          contractId: contract.id,
          actor: 'test-agent',
        });

        expect(accepted.status).toBe('accepted');

        const storedTodo = ledger.db
          .prepare('select status, linked_criterion_id from todos where id = ?')
          .get(todo.id) as { status: string; linked_criterion_id: string };
        const storedVerifier = ledger.db
          .prepare('select kind, criterion_id, config_json, required from verifiers where id = ?')
          .get(verifier.id) as {
          kind: string;
          criterion_id: string;
          config_json: string;
          required: number;
        };

        expect(storedTodo).toEqual({
          status: 'pending',
          linked_criterion_id: criterion.id,
        });
        expect(storedVerifier.kind).toBe('command');
        expect(storedVerifier.criterion_id).toBe(criterion.id);
        expect(JSON.parse(storedVerifier.config_json)).toEqual({
          command: 'npm test -- tests/contract-workflow.test.ts',
        });
        expect(storedVerifier.required).toBe(1);

        const events = ledger.db
          .prepare('select event_type from events where contract_id = ? order by created_at, rowid')
          .all(contract.id) as Array<{ event_type: string }>;

        expect(events.map((event) => event.event_type)).toEqual([
          'contract_created',
          'criterion_added',
          'todo_added',
          'verifier_added',
          'contract_accepted',
        ]);

        expect(listAdapters(ledger).map((adapter) => adapter.name)).toContain('limner');
        expect(listProfiles(ledger).map((profile) => profile.name)).toContain(
          'limner-visual-fidelity',
        );
      } finally {
        ledger.close();
      }
    });
  });

  it('does not record an accepted event when accepting a missing contract', async () => {
    await withTempWorkspace((root) => {
      const ledger = openLedger({ cwd: root });
      const missingContractId = 'ctr_missing';

      try {
        expect(() => {
          acceptContract(ledger, {
            contractId: missingContractId,
            actor: 'test-agent',
          });
        }).toThrow(`Contract not found: ${missingContractId}`);

        const acceptedEvents = ledger.db
          .prepare(
            `
            select count(*) as count
            from events
            where contract_id = ?
              and event_type = 'contract_accepted'
          `,
          )
          .get(missingContractId) as { count: number };

        expect(acceptedEvents.count).toBe(0);
      } finally {
        ledger.close();
      }
    });
  });
});
