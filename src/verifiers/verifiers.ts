import { recordEvent } from '../audit/audit.js';
import { createId } from '../core/ids.js';
import { systemClock, type Clock } from '../core/time.js';
import type { Ledger } from '../db/connection.js';

export type AdapterRecord = {
  id: string;
  name: string;
  version: string;
  kind: string;
  status: string;
  configSchema: unknown;
  artifactPatterns: unknown;
  receiptMapper: unknown;
  requiresJudgment: boolean;
};

export type ProfileRecord = {
  id: string;
  adapterId: string;
  name: string;
  description: string;
  status: string;
  defaultConfig: unknown;
  defaultRequiredArtifacts: unknown;
  defaultFailureModes: unknown;
};

export type AddVerifierInput = {
  contractId: string;
  criterionId?: string;
  adapterId?: string;
  name: string;
  kind: string;
  config: unknown;
  required: boolean;
  actor: string;
  clock?: Clock;
};

export type VerifierRecord = {
  id: string;
  name: string;
};

type AdapterRow = {
  id: string;
  name: string;
  version: string;
  kind: string;
  status: string;
  config_schema_json: string;
  artifact_patterns_json: string;
  receipt_mapper_json: string;
  requires_judgment: number;
};

type ProfileRow = {
  id: string;
  adapter_id: string;
  name: string;
  description: string;
  status: string;
  default_config_json: string;
  default_required_artifacts_json: string;
  default_failure_modes_json: string;
};

export function addVerifier(ledger: Ledger, input: AddVerifierInput): VerifierRecord {
  const id = createId('ver');
  const clock = input.clock ?? systemClock;

  ledger.db
    .prepare(
      `
      insert into verifiers
        (
          id,
          contract_id,
          criterion_id,
          adapter_id,
          name,
          kind,
          config_json,
          required,
          created_at
        )
      values
        (
          @id,
          @contractId,
          @criterionId,
          @adapterId,
          @name,
          @kind,
          @configJson,
          @required,
          @createdAt
        )
    `,
    )
    .run({
      id,
      contractId: input.contractId,
      criterionId: input.criterionId ?? null,
      adapterId: input.adapterId ?? null,
      name: input.name,
      kind: input.kind,
      configJson: JSON.stringify(input.config),
      required: input.required ? 1 : 0,
      createdAt: clock.now(),
    });

  recordEvent(ledger, {
    contractId: input.contractId,
    scopeType: 'verifier',
    scopeId: id,
    actor: input.actor,
    eventType: 'verifier_added',
    payload: {
      name: input.name,
      kind: input.kind,
      criterionId: input.criterionId ?? null,
      adapterId: input.adapterId ?? null,
      required: input.required,
    },
    clock,
  });

  return { id, name: input.name };
}

export function listAdapters(ledger: Ledger): AdapterRecord[] {
  const rows = ledger.db
    .prepare(
      `
      select
        id,
        name,
        version,
        kind,
        status,
        config_schema_json,
        artifact_patterns_json,
        receipt_mapper_json,
        requires_judgment
      from verifier_adapters
      order by name
    `,
    )
    .all() as AdapterRow[];

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    version: row.version,
    kind: row.kind,
    status: row.status,
    configSchema: JSON.parse(row.config_schema_json),
    artifactPatterns: JSON.parse(row.artifact_patterns_json),
    receiptMapper: JSON.parse(row.receipt_mapper_json),
    requiresJudgment: row.requires_judgment === 1,
  }));
}

export function listProfiles(ledger: Ledger): ProfileRecord[] {
  const rows = ledger.db
    .prepare(
      `
      select
        id,
        adapter_id,
        name,
        description,
        status,
        default_config_json,
        default_required_artifacts_json,
        default_failure_modes_json
      from acceptance_profiles
      order by name
    `,
    )
    .all() as ProfileRow[];

  return rows.map((row) => ({
    id: row.id,
    adapterId: row.adapter_id,
    name: row.name,
    description: row.description,
    status: row.status,
    defaultConfig: JSON.parse(row.default_config_json),
    defaultRequiredArtifacts: JSON.parse(row.default_required_artifacts_json),
    defaultFailureModes: JSON.parse(row.default_failure_modes_json),
  }));
}
