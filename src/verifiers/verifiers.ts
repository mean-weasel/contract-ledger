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
  sourceType: string;
  sourceName: string;
  sourceVersion: string;
  sourceUrl: string;
  repoUrl: string;
  docsUrl: string;
  homepageUrl: string;
  registryUrl: string;
  skillRefs: unknown;
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

export type RegisterAdapterInput = {
  name: string;
  version?: string;
  kind: string;
  status?: string;
  configSchema?: unknown;
  artifactPatterns?: unknown;
  receiptMapper?: unknown;
  requiresJudgment?: boolean;
  sourceType?: string;
  sourceName?: string;
  sourceVersion?: string;
  sourceUrl?: string;
  repoUrl?: string;
  docsUrl?: string;
  homepageUrl?: string;
  registryUrl?: string;
  skillRefs?: unknown;
  actor: string;
  clock?: Clock;
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
  source_type: string;
  source_name: string;
  source_version: string;
  source_url: string;
  repo_url: string;
  docs_url: string;
  homepage_url: string;
  registry_url: string;
  skill_refs_json: string;
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

function isPlainJsonObject(value: object): boolean {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertJsonSerializable(value: unknown, fieldName: string, seen = new Set<object>()): void {
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
          assertJsonSerializable(item, fieldName, seen);
        }
        seen.delete(value);
        return;
      }

      if (isPlainJsonObject(value)) {
        for (const item of Object.values(value)) {
          assertJsonSerializable(item, fieldName, seen);
        }
        seen.delete(value);
        return;
      }
      break;
  }

  throw new Error(`${fieldName} must be JSON-serializable without lossy values`);
}

function stringifyJsonField(value: unknown, fieldName: string): string {
  assertJsonSerializable(value, fieldName);
  return JSON.stringify(value);
}

function stringifyJsonArrayField(value: unknown, fieldName: string): string {
  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} must be a JSON array`);
  }
  return stringifyJsonField(value, fieldName);
}

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

function toAdapterRecord(row: AdapterRow): AdapterRecord {
  return {
    id: row.id,
    name: row.name,
    version: row.version,
    kind: row.kind,
    status: row.status,
    configSchema: JSON.parse(row.config_schema_json),
    artifactPatterns: JSON.parse(row.artifact_patterns_json),
    receiptMapper: JSON.parse(row.receipt_mapper_json),
    requiresJudgment: row.requires_judgment === 1,
    sourceType: row.source_type,
    sourceName: row.source_name,
    sourceVersion: row.source_version,
    sourceUrl: row.source_url,
    repoUrl: row.repo_url,
    docsUrl: row.docs_url,
    homepageUrl: row.homepage_url,
    registryUrl: row.registry_url,
    skillRefs: JSON.parse(row.skill_refs_json),
  };
}

export function getAdapterByNameOrId(ledger: Ledger, nameOrId: string): AdapterRecord | undefined {
  const row = ledger.db
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
        requires_judgment,
        source_type,
        source_name,
        source_version,
        source_url,
        repo_url,
        docs_url,
        homepage_url,
        registry_url,
        skill_refs_json
      from verifier_adapters
      where id = ?
        or name = ?
    `,
    )
    .get(nameOrId, nameOrId) as AdapterRow | undefined;

  return row === undefined ? undefined : toAdapterRecord(row);
}

export function registerAdapter(ledger: Ledger, input: RegisterAdapterInput): AdapterRecord {
  const clock = input.clock ?? systemClock;
  const existing = getAdapterByNameOrId(ledger, input.name);
  const id = existing?.id ?? createId('adp');
  const now = clock.now();
  const createdAt =
    existing === undefined
      ? now
      : (
          ledger.db
            .prepare('select created_at from verifier_adapters where id = ?')
            .get(id) as { created_at: string }
        ).created_at;

  ledger.db
    .prepare(
      `
      insert into verifier_adapters
        (
          id,
          name,
          version,
          kind,
          status,
          config_schema_json,
          artifact_patterns_json,
          receipt_mapper_json,
          requires_judgment,
          source_type,
          source_name,
          source_version,
          source_url,
          repo_url,
          docs_url,
          homepage_url,
          registry_url,
          skill_refs_json,
          created_at,
          updated_at
        )
      values
        (
          @id,
          @name,
          @version,
          @kind,
          @status,
          @configSchemaJson,
          @artifactPatternsJson,
          @receiptMapperJson,
          @requiresJudgment,
          @sourceType,
          @sourceName,
          @sourceVersion,
          @sourceUrl,
          @repoUrl,
          @docsUrl,
          @homepageUrl,
          @registryUrl,
          @skillRefsJson,
          @createdAt,
          @updatedAt
        )
      on conflict(name) do update set
        version = excluded.version,
        kind = excluded.kind,
        status = excluded.status,
        config_schema_json = excluded.config_schema_json,
        artifact_patterns_json = excluded.artifact_patterns_json,
        receipt_mapper_json = excluded.receipt_mapper_json,
        requires_judgment = excluded.requires_judgment,
        source_type = excluded.source_type,
        source_name = excluded.source_name,
        source_version = excluded.source_version,
        source_url = excluded.source_url,
        repo_url = excluded.repo_url,
        docs_url = excluded.docs_url,
        homepage_url = excluded.homepage_url,
        registry_url = excluded.registry_url,
        skill_refs_json = excluded.skill_refs_json,
        updated_at = excluded.updated_at
    `,
    )
    .run({
      id,
      name: input.name,
      version: input.version ?? '1',
      kind: input.kind,
      status: input.status ?? 'active',
      sourceType: input.sourceType ?? '',
      sourceName: input.sourceName ?? '',
      sourceVersion: input.sourceVersion ?? '',
      sourceUrl: input.sourceUrl ?? '',
      repoUrl: input.repoUrl ?? '',
      docsUrl: input.docsUrl ?? '',
      homepageUrl: input.homepageUrl ?? '',
      registryUrl: input.registryUrl ?? '',
      configSchemaJson: stringifyJsonField(input.configSchema ?? {}, 'configSchema'),
      artifactPatternsJson: stringifyJsonArrayField(input.artifactPatterns ?? [], 'artifactPatterns'),
      receiptMapperJson: stringifyJsonField(input.receiptMapper ?? {}, 'receiptMapper'),
      skillRefsJson: stringifyJsonArrayField(input.skillRefs ?? [], 'skillRefs'),
      requiresJudgment: input.requiresJudgment === true ? 1 : 0,
      createdAt,
      updatedAt: now,
    });

  const adapter = getAdapterByNameOrId(ledger, input.name);
  if (adapter === undefined) {
    throw new Error(`Adapter not found after registration: ${input.name}`);
  }

  recordEvent(ledger, {
    scopeType: 'adapter',
    scopeId: adapter.id,
    actor: input.actor,
    eventType: existing === undefined ? 'adapter_added' : 'adapter_updated',
    payload: {
      name: adapter.name,
      version: adapter.version,
      kind: adapter.kind,
      status: adapter.status,
      requiresJudgment: adapter.requiresJudgment,
      sourceType: adapter.sourceType,
      sourceName: adapter.sourceName,
      sourceVersion: adapter.sourceVersion,
      sourceUrl: adapter.sourceUrl,
      repoUrl: adapter.repoUrl,
      docsUrl: adapter.docsUrl,
      homepageUrl: adapter.homepageUrl,
      registryUrl: adapter.registryUrl,
      skillRefs: adapter.skillRefs,
    },
    clock,
  });

  return adapter;
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
        requires_judgment,
        source_type,
        source_name,
        source_version,
        source_url,
        repo_url,
        docs_url,
        homepage_url,
        registry_url,
        skill_refs_json
      from verifier_adapters
      order by name
    `,
    )
    .all() as AdapterRow[];

  return rows.map(toAdapterRecord);
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
