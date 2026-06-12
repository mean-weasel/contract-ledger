import { assessCloseoutReadiness, getContract } from './contracts.js';
import type { Ledger } from '../db/connection.js';

type JsonValue = unknown;

export type ContractSnapshot = {
  contract: {
    id: string;
    title: string;
    intent: string;
    scope: string;
    status: string;
    createdBy: string;
    createdAt: string;
    acceptedAt: string | null;
    closedAt: string | null;
  };
  criteria: Array<Record<string, unknown>>;
  todos: Array<Record<string, unknown>>;
  verifiers: Array<Record<string, unknown>>;
  failureModes: Array<Record<string, unknown>>;
  receipts: Array<Record<string, unknown>>;
  closeoutProblems: string[];
};

export type ContractStatusRow = {
  id: string;
  title: string;
  status: string;
  criteriaPending: number;
  criteriaSatisfied: number;
  todosPending: number;
  requiredVerifiersMissingReceipts: number;
  requiredFailureModesPending: number;
  receiptsPassing: number;
};

export type NextActionReport = {
  contractId: string;
  readyToClose: boolean;
  problems: string[];
  nextActions: string[];
};

export type AuditLogEntry = {
  id: string;
  createdAt: string;
  eventType: string;
  actor: string;
  scopeType: string;
  scopeId: string | null;
  contractId: string | null;
  commandInvocationId: string | null;
  subcommand: string | null;
  payload: JsonValue;
};

type ContractSnapshotRow = {
  id: string;
  title: string;
  intent: string;
  scope: string;
  status: string;
  created_by: string;
  created_at: string;
  accepted_at: string | null;
  closed_at: string | null;
};

function parseJson(value: string | null): JsonValue {
  if (value === null || value.trim() === '') {
    return null;
  }

  return JSON.parse(value);
}

export function getContractSnapshot(ledger: Ledger, contractId: string): ContractSnapshot {
  const contract = ledger.db
    .prepare(
      `
      select
        id,
        title,
        intent,
        scope,
        status,
        created_by,
        created_at,
        accepted_at,
        closed_at
      from contracts
      where id = ?
    `,
    )
    .get(contractId) as ContractSnapshotRow | undefined;

  if (contract === undefined) {
    throw new Error(`Contract not found: ${contractId}`);
  }

  const criteria = ledger.db
    .prepare(
      `
      select
        id,
        statement,
        required_evidence_kind as requiredEvidenceKind,
        priority,
        status,
        rationale,
        residual_risk as residualRisk,
        created_at as createdAt,
        satisfied_at as satisfiedAt
      from criteria
      where contract_id = ?
      order by priority desc, created_at, rowid
    `,
    )
    .all(contractId) as Array<Record<string, unknown>>;

  const todos = ledger.db
    .prepare(
      `
      select
        id,
        title,
        description,
        status,
        linked_criterion_id as linkedCriterionId,
        claimed_by as claimedBy,
        created_at as createdAt,
        completed_at as completedAt
      from todos
      where contract_id = ?
      order by created_at, rowid
    `,
    )
    .all(contractId) as Array<Record<string, unknown>>;

  const verifiers = (
    ledger.db
      .prepare(
        `
        select
          verifiers.id,
          verifiers.criterion_id as criterionId,
          verifiers.adapter_id as adapterId,
          verifier_adapters.name as adapterName,
          verifier_adapters.source_type as adapterSourceType,
          verifier_adapters.docs_url as adapterDocsUrl,
          verifier_adapters.skill_refs_json as adapterSkillRefsJson,
          verifiers.name,
          verifiers.kind,
          verifiers.config_json as configJson,
          verifiers.required,
          verifiers.created_at as createdAt
        from verifiers
        left join verifier_adapters on verifier_adapters.id = verifiers.adapter_id
        where verifiers.contract_id = ?
        order by verifiers.created_at, verifiers.rowid
      `,
      )
      .all(contractId) as Array<
        Record<string, unknown> & { adapterSkillRefsJson: string | null; configJson: string; required: number }
      >
  ).map((verifier) => ({
    ...verifier,
    adapterSkillRefs: parseJson(verifier.adapterSkillRefsJson),
    adapterSkillRefsJson: undefined,
    config: parseJson(verifier.configJson),
    configJson: undefined,
    required: verifier.required === 1,
  }));

  const failureModes = (
    ledger.db
      .prepare(
        `
        select
          id,
          failure_mode as failureMode,
          why_plausible as whyPlausible,
          linked_criterion_id as linkedCriterionId,
          check_description as checkDescription,
          expected_verifier_id as expectedVerifierId,
          expected_proof_json as expectedProofJson,
          resolution_rule as resolutionRule,
          status,
          required,
          fewer_than_default_reason as fewerThanDefaultReason,
          residual_risk as residualRisk,
          created_at as createdAt,
          resolved_at as resolvedAt
        from failure_modes
        where contract_id = ?
        order by created_at, rowid
      `,
      )
      .all(contractId) as Array<
      Record<string, unknown> & { expectedProofJson: string; required: number }
    >
  ).map((failureMode) => ({
    ...failureMode,
    expectedProof: parseJson(failureMode.expectedProofJson),
    expectedProofJson: undefined,
    required: failureMode.required === 1,
  }));

  const receipts = (
    ledger.db
      .prepare(
        `
        select
          id,
          criterion_id as criterionId,
          verifier_id as verifierId,
          todo_id as todoId,
          disproof_attempt_id as disproofAttemptId,
          kind,
          status,
          summary,
          command,
          exit_code as exitCode,
          adapter_metadata_json as adapterMetadataJson,
          content_hash as contentHash,
          created_by as createdBy,
          created_at as createdAt
        from receipts
        where contract_id = ?
        order by created_at, rowid
      `,
      )
      .all(contractId) as Array<Record<string, unknown> & { adapterMetadataJson: string | null }>
  ).map((receipt) => ({
    ...receipt,
    adapterMetadata: parseJson(receipt.adapterMetadataJson),
    adapterMetadataJson: undefined,
  }));

  return {
    contract: {
      id: contract.id,
      title: contract.title,
      intent: contract.intent,
      scope: contract.scope,
      status: contract.status,
      createdBy: contract.created_by,
      createdAt: contract.created_at,
      acceptedAt: contract.accepted_at,
      closedAt: contract.closed_at,
    },
    criteria,
    todos,
    verifiers,
    failureModes,
    receipts,
    closeoutProblems: assessCloseoutReadiness(ledger, contractId),
  };
}

export function listContractStatuses(ledger: Ledger, contractId?: string): ContractStatusRow[] {
  if (contractId !== undefined && getContract(ledger, contractId) === undefined) {
    throw new Error(`Contract not found: ${contractId}`);
  }

  const where = contractId === undefined ? '' : 'where contracts.id = @contractId';

  return ledger.db
    .prepare(
      `
      select
        contracts.id,
        contracts.title,
        contracts.status,
        (
          select count(*)
          from criteria
          where criteria.contract_id = contracts.id
            and criteria.status = 'pending'
        ) as criteriaPending,
        (
          select count(*)
          from criteria
          where criteria.contract_id = contracts.id
            and criteria.status = 'satisfied'
        ) as criteriaSatisfied,
        (
          select count(*)
          from todos
          where todos.contract_id = contracts.id
            and todos.status = 'pending'
        ) as todosPending,
        (
          select count(*)
          from verifiers
          where verifiers.contract_id = contracts.id
            and verifiers.required = 1
            and not exists (
              select 1
              from receipts
              where receipts.contract_id = verifiers.contract_id
                and receipts.verifier_id = verifiers.id
                and receipts.status = 'pass'
            )
        ) as requiredVerifiersMissingReceipts,
        (
          select count(*)
          from failure_modes
          where failure_modes.contract_id = contracts.id
            and failure_modes.required = 1
            and failure_modes.status = 'pending'
        ) as requiredFailureModesPending,
        (
          select count(*)
          from receipts
          where receipts.contract_id = contracts.id
            and receipts.status = 'pass'
        ) as receiptsPassing
      from contracts
      ${where}
      order by contracts.created_at desc, contracts.rowid desc
    `,
    )
    .all({ contractId }) as ContractStatusRow[];
}

export function getNextActionReport(ledger: Ledger, contractId: string): NextActionReport {
  const snapshot = getContractSnapshot(ledger, contractId);
  const problems = snapshot.closeoutProblems;
  const nextActions: string[] = [];

  if (snapshot.contract.status === 'draft') {
    nextActions.push(`Accept the contract: contract accept ${contractId}`);
  }

  for (const criterion of snapshot.criteria.filter((item) => item.status === 'pending')) {
    nextActions.push(`Resolve pending criterion ${criterion.id}: ${criterion.statement}`);
  }

  for (const verifier of snapshot.verifiers.filter((item) => item.required === true)) {
    const hasPassingReceipt = snapshot.receipts.some(
      (receipt) => receipt.verifierId === verifier.id && receipt.status === 'pass',
    );
    if (!hasPassingReceipt) {
      nextActions.push(`Run or record a passing receipt for verifier ${verifier.id}: ${verifier.name}`);
    }
  }

  for (const failureMode of snapshot.failureModes.filter(
    (item) => item.required === true && item.status === 'pending',
  )) {
    nextActions.push(`Resolve required failure mode ${failureMode.id}: ${failureMode.failureMode}`);
  }

  if (nextActions.length === 0 && problems.length === 0) {
    nextActions.push(`Close the contract: contract close ${contractId}`);
  }

  return {
    contractId,
    readyToClose: problems.length === 0,
    problems,
    nextActions,
  };
}

export function listAuditLog(ledger: Ledger, contractId?: string): AuditLogEntry[] {
  if (contractId !== undefined && getContract(ledger, contractId) === undefined) {
    throw new Error(`Contract not found: ${contractId}`);
  }

  const where = contractId === undefined ? '' : 'where events.contract_id = @contractId';

  const rows = ledger.db
    .prepare(
      `
      select
        events.id,
        events.created_at as createdAt,
        events.event_type as eventType,
        events.actor,
        events.scope_type as scopeType,
        events.scope_id as scopeId,
        events.contract_id as contractId,
        events.command_invocation_id as commandInvocationId,
        command_invocations.subcommand as subcommand,
        events.payload_json as payloadJson
      from events
      left join command_invocations on command_invocations.id = events.command_invocation_id
      ${where}
      order by events.created_at, events.rowid
    `,
    )
    .all({ contractId }) as Array<Omit<AuditLogEntry, 'payload'> & { payloadJson: string }>;

  return rows.map((row) => ({
    id: row.id,
    createdAt: row.createdAt,
    eventType: row.eventType,
    actor: row.actor,
    scopeType: row.scopeType,
    scopeId: row.scopeId,
    contractId: row.contractId,
    commandInvocationId: row.commandInvocationId,
    subcommand: row.subcommand,
    payload: parseJson(row.payloadJson),
  }));
}
