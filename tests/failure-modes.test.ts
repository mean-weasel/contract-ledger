import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  addCriterion,
  addFailureMode,
  addVerifier,
  createContract,
  listFailureModes,
  openLedger,
  resolveFailureMode,
} from '../src/index.js';

async function withTempWorkspace<T>(fn: (root: string) => T | Promise<T>): Promise<T> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'failure-modes-'));

  try {
    return await fn(root);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

describe('failure mode queue', () => {
  it('records structured failure modes with optional same-contract links and audit events', async () => {
    await withTempWorkspace((root) => {
      const ledger = openLedger({ cwd: root });

      try {
        const contract = createContract(ledger, {
          title: 'Harden dashboard launch',
          createdBy: 'test-agent',
        });
        const criterion = addCriterion(ledger, {
          contractId: contract.id,
          statement: 'Visual proof covers the empty dashboard state.',
          requiredEvidenceKind: 'visual',
          actor: 'test-agent',
        });
        const verifier = addVerifier(ledger, {
          contractId: contract.id,
          criterionId: criterion.id,
          adapterId: 'adp_command_builtin',
          name: 'Run visual check',
          kind: 'command',
          config: { command: 'npm test -- tests/failure-modes.test.ts' },
          required: true,
          actor: 'test-agent',
        });

        const failureMode = addFailureMode(ledger, {
          contractId: contract.id,
          failureMode: 'The empty dashboard state hides a broken CTA.',
          whyPlausible: 'The normal fixture has data, so empty copy can escape review.',
          linkedCriterionId: criterion.id,
          checkDescription: 'Capture the dashboard with no projects and inspect primary CTA copy.',
          expectedVerifierId: verifier.id,
          expectedProof: {
            command: 'npm test -- tests/failure-modes.test.ts',
            artifacts: ['empty-dashboard.png'],
          },
          resolutionRule: 'Must show either a passing visual receipt or an accepted risk note.',
          required: true,
          fewerThanDefaultReason: 'Only one empty-state path exists in V1.',
          actor: 'test-agent',
        });

        const stored = ledger.db
          .prepare(
            `
            select
              contract_id,
              failure_mode,
              why_plausible,
              linked_criterion_id,
              check_description,
              expected_verifier_id,
              expected_proof_json,
              resolution_rule,
              status,
              required,
              fewer_than_default_reason
            from failure_modes
            where id = ?
          `,
          )
          .get(failureMode.id) as {
          contract_id: string;
          failure_mode: string;
          why_plausible: string;
          linked_criterion_id: string;
          check_description: string;
          expected_verifier_id: string;
          expected_proof_json: string;
          resolution_rule: string;
          status: string;
          required: number;
          fewer_than_default_reason: string;
        };

        expect(stored).toMatchObject({
          contract_id: contract.id,
          failure_mode: 'The empty dashboard state hides a broken CTA.',
          why_plausible: 'The normal fixture has data, so empty copy can escape review.',
          linked_criterion_id: criterion.id,
          check_description: 'Capture the dashboard with no projects and inspect primary CTA copy.',
          expected_verifier_id: verifier.id,
          resolution_rule: 'Must show either a passing visual receipt or an accepted risk note.',
          status: 'pending',
          required: 1,
          fewer_than_default_reason: 'Only one empty-state path exists in V1.',
        });
        expect(JSON.parse(stored.expected_proof_json)).toEqual({
          command: 'npm test -- tests/failure-modes.test.ts',
          artifacts: ['empty-dashboard.png'],
        });

        const events = ledger.db
          .prepare(
            `
            select event_type, scope_type, scope_id, payload_json
            from events
            where contract_id = ?
            order by created_at, rowid
          `,
          )
          .all(contract.id) as Array<{
          event_type: string;
          scope_type: string;
          scope_id: string;
          payload_json: string;
        }>;

        expect(events.map((event) => event.event_type)).toContain('failure_mode_added');
        const event = events.find((candidate) => candidate.event_type === 'failure_mode_added');
        expect(event).toMatchObject({
          scope_type: 'failure_mode',
          scope_id: failureMode.id,
        });
        expect(JSON.parse(event?.payload_json ?? '{}')).toMatchObject({
          failureMode: 'The empty dashboard state hides a broken CTA.',
          linkedCriterionId: criterion.id,
          expectedVerifierId: verifier.id,
          required: true,
        });
      } finally {
        ledger.close();
      }
    });
  });

  it('resolves a failure mode and records the status-change event', async () => {
    await withTempWorkspace((root) => {
      const ledger = openLedger({ cwd: root });

      try {
        const contract = createContract(ledger, {
          title: 'Resolve falsification queue',
          createdBy: 'test-agent',
        });
        const failureMode = addFailureMode(ledger, {
          contractId: contract.id,
          failureMode: 'Status can remain pending after proof.',
          whyPlausible: 'Resolution writes are separate from creation.',
          checkDescription: 'Resolve and inspect persisted status.',
          expectedProof: { receipt: 'manual-review' },
          resolutionRule: 'Confirmed when reproduced locally.',
          required: false,
          actor: 'test-agent',
        });

        resolveFailureMode(ledger, {
          id: failureMode.id,
          status: 'confirmed',
          residualRisk: 'Follow-up remediation required.',
          actor: 'reviewer',
          clock: { now: () => '2026-01-01T00:02:00.000Z' },
        });

        const stored = ledger.db
          .prepare('select contract_id, status, residual_risk, resolved_at from failure_modes where id = ?')
          .get(failureMode.id) as {
          contract_id: string;
          status: string;
          residual_risk: string;
          resolved_at: string;
        };
        expect(stored).toEqual({
          contract_id: contract.id,
          status: 'confirmed',
          residual_risk: 'Follow-up remediation required.',
          resolved_at: '2026-01-01T00:02:00.000Z',
        });

        const event = ledger.db
          .prepare(
            `
            select event_type, contract_id, scope_type, scope_id, actor, payload_json
            from events
            where event_type = 'failure_mode_status_changed'
          `,
          )
          .get() as {
          event_type: string;
          contract_id: string;
          scope_type: string;
          scope_id: string;
          actor: string;
          payload_json: string;
        };

        expect(event).toMatchObject({
          event_type: 'failure_mode_status_changed',
          contract_id: contract.id,
          scope_type: 'failure_mode',
          scope_id: failureMode.id,
          actor: 'reviewer',
        });
        expect(JSON.parse(event.payload_json)).toEqual({
          status: 'confirmed',
          residualRisk: 'Follow-up remediation required.',
        });
      } finally {
        ledger.close();
      }
    });
  });

  it('rejects invalid runtime status without updating or recording a status-change event', async () => {
    await withTempWorkspace((root) => {
      const ledger = openLedger({ cwd: root });

      try {
        const contract = createContract(ledger, {
          title: 'Reject invalid status',
          createdBy: 'test-agent',
        });
        const failureMode = addFailureMode(ledger, {
          contractId: contract.id,
          failureMode: 'Runtime caller bypasses TypeScript.',
          whyPlausible: 'Built JavaScript can pass arbitrary strings.',
          checkDescription: 'Attempt to resolve with an unsupported status.',
          expectedProof: { receipt: 'manual-review' },
          resolutionRule: 'Only known terminal statuses are valid.',
          required: true,
          actor: 'test-agent',
        });

        expect(() => {
          resolveFailureMode(ledger, {
            id: failureMode.id,
            status: 'done' as never,
            actor: 'test-agent',
          });
        }).toThrow('Invalid failure mode status: done');

        const stored = ledger.db
          .prepare('select status, residual_risk, resolved_at from failure_modes where id = ?')
          .get(failureMode.id) as {
          status: string;
          residual_risk: string | null;
          resolved_at: string | null;
        };
        expect(stored).toEqual({
          status: 'pending',
          residual_risk: null,
          resolved_at: null,
        });

        const statusChangeEvents = ledger.db
          .prepare(
            `
            select count(*) as count
            from events
            where event_type = 'failure_mode_status_changed'
          `,
          )
          .get() as { count: number };

        expect(statusChangeEvents.count).toBe(0);
      } finally {
        ledger.close();
      }
    });
  });

  it('rejects lossy expectedProof values before inserting or recording an added event', async () => {
    await withTempWorkspace((root) => {
      const ledger = openLedger({ cwd: root });

      try {
        const contract = createContract(ledger, {
          title: 'Reject lossy expected proof',
          createdBy: 'test-agent',
        });
        const invalidProofs = [
          { label: 'undefined', value: { command: undefined } },
          { label: 'function', value: { command: () => 'npm test' } },
          { label: 'NaN', value: { metrics: [Number.NaN] } },
        ];

        for (const invalidProof of invalidProofs) {
          expect(() => {
            addFailureMode(ledger, {
              contractId: contract.id,
              failureMode: `Lossy expected proof ${invalidProof.label}.`,
              whyPlausible: 'JSON.stringify can silently change the proof shape.',
              checkDescription: 'Attempt to insert unsupported expected proof data.',
              expectedProof: invalidProof.value,
              resolutionRule: 'Reject lossy proof values.',
              required: true,
              actor: 'test-agent',
            });
          }).toThrow('expectedProof must be JSON-serializable without lossy values');
        }

        const rows = ledger.db
          .prepare(
            `
            select count(*) as count
            from failure_modes
            where contract_id = ?
          `,
          )
          .get(contract.id) as { count: number };
        const addedEvents = ledger.db
          .prepare(
            `
            select count(*) as count
            from events
            where contract_id = ?
              and event_type = 'failure_mode_added'
          `,
          )
          .get(contract.id) as { count: number };

        expect(rows.count).toBe(0);
        expect(addedEvents.count).toBe(0);
      } finally {
        ledger.close();
      }
    });
  });

  it('lists contract failure modes ordered by creation time', async () => {
    await withTempWorkspace((root) => {
      const ledger = openLedger({ cwd: root });

      try {
        const firstContract = createContract(ledger, {
          title: 'First contract',
          createdBy: 'test-agent',
        });
        const secondContract = createContract(ledger, {
          title: 'Second contract',
          createdBy: 'test-agent',
        });
        const clockValues = [
          '2026-01-01T00:02:00.000Z',
          '2026-01-01T00:02:30.000Z',
          '2026-01-01T00:01:00.000Z',
          '2026-01-01T00:01:30.000Z',
          '2026-01-01T00:03:00.000Z',
          '2026-01-01T00:03:30.000Z',
        ];
        const clock = { now: () => clockValues.shift() ?? '2026-01-01T00:04:00.000Z' };
        const later = addFailureMode(ledger, {
          contractId: firstContract.id,
          failureMode: 'Later failure',
          whyPlausible: 'Inserted first but created later.',
          checkDescription: 'Check later condition.',
          expectedProof: {},
          resolutionRule: 'Resolve later.',
          required: false,
          actor: 'test-agent',
          clock,
        });
        const earlier = addFailureMode(ledger, {
          contractId: firstContract.id,
          failureMode: 'Earlier failure',
          whyPlausible: 'Inserted second but created earlier.',
          checkDescription: 'Check earlier condition.',
          expectedProof: {},
          resolutionRule: 'Resolve earlier.',
          required: true,
          actor: 'test-agent',
          clock,
        });
        addFailureMode(ledger, {
          contractId: secondContract.id,
          failureMode: 'Other contract failure',
          whyPlausible: 'Should not be listed for first contract.',
          checkDescription: 'Check isolation.',
          expectedProof: {},
          resolutionRule: 'Resolve elsewhere.',
          required: true,
          actor: 'test-agent',
          clock,
        });

        expect(listFailureModes(ledger, firstContract.id)).toEqual([
          {
            id: earlier.id,
            failure_mode: 'Earlier failure',
            why_plausible: 'Inserted second but created earlier.',
            status: 'pending',
            required: 1,
          },
          {
            id: later.id,
            failure_mode: 'Later failure',
            why_plausible: 'Inserted first but created later.',
            status: 'pending',
            required: 0,
          },
        ]);
      } finally {
        ledger.close();
      }
    });
  });

  it('throws without recording a status-change event when resolving a missing failure mode', async () => {
    await withTempWorkspace((root) => {
      const ledger = openLedger({ cwd: root });

      try {
        const missingId = 'fm_missing';

        expect(() => {
          resolveFailureMode(ledger, {
            id: missingId,
            status: 'ruled_out',
            actor: 'test-agent',
          });
        }).toThrow(`Failure mode not found: ${missingId}`);

        const statusChangeEvents = ledger.db
          .prepare(
            `
            select count(*) as count
            from events
            where event_type = 'failure_mode_status_changed'
          `,
          )
          .get() as { count: number };

        expect(statusChangeEvents.count).toBe(0);
      } finally {
        ledger.close();
      }
    });
  });

  it('rejects cross-contract linked criteria and expected verifiers before audit events', async () => {
    await withTempWorkspace((root) => {
      const ledger = openLedger({ cwd: root });

      try {
        const firstContract = createContract(ledger, {
          title: 'First contract',
          createdBy: 'test-agent',
        });
        const secondContract = createContract(ledger, {
          title: 'Second contract',
          createdBy: 'test-agent',
        });
        const otherCriterion = addCriterion(ledger, {
          contractId: secondContract.id,
          statement: 'Belongs to another contract.',
          requiredEvidenceKind: 'manual',
          actor: 'test-agent',
        });
        const otherVerifier = addVerifier(ledger, {
          contractId: secondContract.id,
          criterionId: otherCriterion.id,
          name: 'Other verifier',
          kind: 'manual',
          config: {},
          required: false,
          actor: 'test-agent',
        });

        expect(() => {
          addFailureMode(ledger, {
            contractId: firstContract.id,
            failureMode: 'Cross-contract link sneaks in.',
            whyPlausible: 'Linked ids are globally unique-looking strings.',
            linkedCriterionId: otherCriterion.id,
            checkDescription: 'Attempt a mismatched criterion link.',
            expectedProof: {},
            resolutionRule: 'Must fail FK validation.',
            required: true,
            actor: 'test-agent',
          });
        }).toThrow();
        expect(() => {
          addFailureMode(ledger, {
            contractId: firstContract.id,
            failureMode: 'Cross-contract verifier sneaks in.',
            whyPlausible: 'Verifier ids can be copied between contracts.',
            checkDescription: 'Attempt a mismatched verifier link.',
            expectedVerifierId: otherVerifier.id,
            expectedProof: {},
            resolutionRule: 'Must fail FK validation.',
            required: true,
            actor: 'test-agent',
          });
        }).toThrow();

        const failureModeEvents = ledger.db
          .prepare(
            `
            select count(*) as count
            from events
            where contract_id = ?
              and event_type = 'failure_mode_added'
          `,
          )
          .get(firstContract.id) as { count: number };

        expect(failureModeEvents.count).toBe(0);
      } finally {
        ledger.close();
      }
    });
  });
});
