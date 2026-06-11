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

export type CriterionStatus = 'pending' | 'satisfied' | 'deferred' | 'rejected';

export type UpdateCriterionStatusInput = {
  id: string;
  status: CriterionStatus;
  rationale?: string;
  residualRisk?: string;
  actor: string;
  clock?: Clock;
};

type CriterionContractRow = {
  contract_id: string;
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

export function updateCriterionStatus(
  ledger: Ledger,
  input: UpdateCriterionStatusInput,
): CriterionRecord {
  const clock = input.clock ?? systemClock;
  const contract = ledger.db
    .prepare('select contract_id from criteria where id = ?')
    .get(input.id) as CriterionContractRow | undefined;

  if (contract === undefined) {
    throw new Error(`Criterion not found: ${input.id}`);
  }

  if (
    (input.status === 'deferred' || input.status === 'rejected') &&
    ((input.rationale ?? '').trim() === '' || (input.residualRisk ?? '').trim() === '')
  ) {
    throw new Error(`${input.status} criteria require rationale and residual risk`);
  }

  ledger.db
    .prepare(
      `
      update criteria
      set
        status = @status,
        rationale = @rationale,
        residual_risk = @residualRisk,
        satisfied_at = @satisfiedAt
      where id = @id
    `,
    )
    .run({
      id: input.id,
      status: input.status,
      rationale: input.rationale ?? null,
      residualRisk: input.residualRisk ?? null,
      satisfiedAt: input.status === 'satisfied' ? clock.now() : null,
    });

  recordEvent(ledger, {
    contractId: contract.contract_id,
    scopeType: 'criterion',
    scopeId: input.id,
    actor: input.actor,
    eventType: 'criterion_status_changed',
    payload: {
      status: input.status,
      rationale: input.rationale ?? null,
      residualRisk: input.residualRisk ?? null,
    },
    clock,
  });

  return { id: input.id, status: input.status };
}
