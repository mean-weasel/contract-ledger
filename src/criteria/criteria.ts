import { recordEvent } from '../audit/audit.js';
import { createId } from '../core/ids.js';
import { systemClock, type Clock } from '../core/time.js';
import type { Ledger } from '../db/connection.js';

export type AddCriterionInput = {
  contractId: string;
  statement: string;
  requiredEvidenceKind: string;
  priority?: number;
  actor: string;
  clock?: Clock;
};

export type CriterionRecord = {
  id: string;
  status: string;
};

export function addCriterion(ledger: Ledger, input: AddCriterionInput): CriterionRecord {
  const id = createId('crit');
  const status = 'pending';
  const clock = input.clock ?? systemClock;

  ledger.db
    .prepare(
      `
      insert into criteria
        (
          id,
          contract_id,
          statement,
          required_evidence_kind,
          priority,
          status,
          created_at
        )
      values
        (
          @id,
          @contractId,
          @statement,
          @requiredEvidenceKind,
          @priority,
          @status,
          @createdAt
        )
    `,
    )
    .run({
      id,
      contractId: input.contractId,
      statement: input.statement,
      requiredEvidenceKind: input.requiredEvidenceKind,
      priority: input.priority ?? 0,
      status,
      createdAt: clock.now(),
    });

  recordEvent(ledger, {
    contractId: input.contractId,
    scopeType: 'criterion',
    scopeId: id,
    actor: input.actor,
    eventType: 'criterion_added',
    payload: {
      statement: input.statement,
      requiredEvidenceKind: input.requiredEvidenceKind,
      priority: input.priority ?? 0,
    },
    clock,
  });

  return { id, status };
}
