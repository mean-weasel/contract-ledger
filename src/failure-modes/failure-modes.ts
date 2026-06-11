import { recordEvent } from '../audit/audit.js';
import { createId } from '../core/ids.js';
import { systemClock, type Clock } from '../core/time.js';
import type { Ledger } from '../db/connection.js';

export type FailureModeRecord = {
  id: string;
  failure_mode: string;
  why_plausible: string;
  status: string;
  required: number;
};

export type AddFailureModeInput = {
  contractId: string;
  failureMode: string;
  whyPlausible: string;
  linkedCriterionId?: string;
  checkDescription: string;
  expectedVerifierId?: string;
  expectedProof: unknown;
  resolutionRule: string;
  required: boolean;
  fewerThanDefaultReason?: string;
  actor: string;
  clock?: Clock;
};

export type FailureModeResolutionStatus =
  | 'ruled_out'
  | 'confirmed'
  | 'inconclusive'
  | 'accepted_risk';

export type ResolveFailureModeInput = {
  id: string;
  status: FailureModeResolutionStatus;
  residualRisk?: string;
  actor: string;
  clock?: Clock;
};

type FailureModeContractRow = {
  contract_id: string;
};

const FAILURE_MODE_RESOLUTION_STATUSES: ReadonlySet<string> = new Set([
  'ruled_out',
  'confirmed',
  'inconclusive',
  'accepted_risk',
]);

function assertFailureModeResolutionStatus(status: unknown): asserts status is FailureModeResolutionStatus {
  if (typeof status !== 'string' || !FAILURE_MODE_RESOLUTION_STATUSES.has(status)) {
    throw new Error(`Invalid failure mode status: ${String(status)}`);
  }
}

function isPlainJsonObject(value: object): boolean {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertJsonSerializable(value: unknown, seen = new Set<object>()): void {
  if (value === null) {
    return;
  }

  switch (typeof value) {
    case 'string':
    case 'boolean':
      return;
    case 'number':
      if (Number.isFinite(value)) {
        return;
      }
      break;
    case 'object':
      if (seen.has(value)) {
        break;
      }
      seen.add(value);

      if (Array.isArray(value)) {
        for (const item of value) {
          assertJsonSerializable(item, seen);
        }
        seen.delete(value);
        return;
      }

      if (isPlainJsonObject(value)) {
        for (const item of Object.values(value)) {
          assertJsonSerializable(item, seen);
        }
        seen.delete(value);
        return;
      }
      break;
  }

  throw new Error('expectedProof must be JSON-serializable without lossy values');
}

function stringifyExpectedProof(expectedProof: unknown): string {
  assertJsonSerializable(expectedProof);
  return JSON.stringify(expectedProof);
}

export function addFailureMode(ledger: Ledger, input: AddFailureModeInput): { id: string } {
  const id = createId('fm');
  const status = 'pending';
  const clock = input.clock ?? systemClock;
  const createdAt = clock.now();
  const expectedProofJson = stringifyExpectedProof(input.expectedProof);

  ledger.db
    .prepare(
      `
      insert into failure_modes
        (
          id,
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
          fewer_than_default_reason,
          created_at
        )
      values
        (
          @id,
          @contractId,
          @failureMode,
          @whyPlausible,
          @linkedCriterionId,
          @checkDescription,
          @expectedVerifierId,
          @expectedProofJson,
          @resolutionRule,
          @status,
          @required,
          @fewerThanDefaultReason,
          @createdAt
        )
    `,
    )
    .run({
      id,
      contractId: input.contractId,
      failureMode: input.failureMode,
      whyPlausible: input.whyPlausible,
      linkedCriterionId: input.linkedCriterionId ?? null,
      checkDescription: input.checkDescription,
      expectedVerifierId: input.expectedVerifierId ?? null,
      expectedProofJson,
      resolutionRule: input.resolutionRule,
      status,
      required: input.required ? 1 : 0,
      fewerThanDefaultReason: input.fewerThanDefaultReason ?? null,
      createdAt,
    });

  recordEvent(ledger, {
    contractId: input.contractId,
    scopeType: 'failure_mode',
    scopeId: id,
    actor: input.actor,
    eventType: 'failure_mode_added',
    payload: {
      failureMode: input.failureMode,
      whyPlausible: input.whyPlausible,
      linkedCriterionId: input.linkedCriterionId ?? null,
      expectedVerifierId: input.expectedVerifierId ?? null,
      required: input.required,
    },
    clock,
  });

  return { id };
}

export function resolveFailureMode(ledger: Ledger, input: ResolveFailureModeInput): void {
  assertFailureModeResolutionStatus(input.status);

  const clock = input.clock ?? systemClock;
  const existing = ledger.db
    .prepare(
      `
      select contract_id
      from failure_modes
      where id = ?
    `,
    )
    .get(input.id) as FailureModeContractRow | undefined;

  if (existing === undefined) {
    throw new Error(`Failure mode not found: ${input.id}`);
  }

  ledger.db
    .prepare(
      `
      update failure_modes
      set
        status = @status,
        residual_risk = @residualRisk,
        resolved_at = @resolvedAt
      where id = @id
    `,
    )
    .run({
      id: input.id,
      status: input.status,
      residualRisk: input.residualRisk ?? null,
      resolvedAt: clock.now(),
    });

  recordEvent(ledger, {
    contractId: existing.contract_id,
    scopeType: 'failure_mode',
    scopeId: input.id,
    actor: input.actor,
    eventType: 'failure_mode_status_changed',
    payload: {
      status: input.status,
      residualRisk: input.residualRisk ?? null,
    },
    clock,
  });
}

export function listFailureModes(ledger: Ledger, contractId: string): FailureModeRecord[] {
  return ledger.db
    .prepare(
      `
      select
        id,
        failure_mode,
        why_plausible,
        status,
        required
      from failure_modes
      where contract_id = ?
      order by created_at
    `,
    )
    .all(contractId) as FailureModeRecord[];
}
