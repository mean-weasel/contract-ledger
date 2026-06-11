import path from 'node:path';

import { recordEvent } from '../audit/audit.js';
import { createId } from '../core/ids.js';
import { systemClock, type Clock } from '../core/time.js';
import type { Ledger } from '../db/connection.js';

export type ContractRecord = {
  id: string;
  title: string;
  intent: string;
  scope: string;
  status: string;
};

type ContractRow = {
  id: string;
  title: string;
  intent: string;
  scope: string;
  status: string;
};

export type CreateContractInput = {
  title: string;
  intent?: string;
  scope?: string;
  nonGoals?: string;
  assumptions?: string;
  createdBy: string;
  clock?: Clock;
};

export type AcceptContractInput = {
  contractId: string;
  actor: string;
  clock?: Clock;
};

export type CloseContractInput = {
  contractId: string;
  actor: string;
  clock?: Clock;
};

export type CloseContractResult = {
  ok: boolean;
  problems: string[];
};

function toContractRecord(row: ContractRow): ContractRecord {
  return {
    id: row.id,
    title: row.title,
    intent: row.intent,
    scope: row.scope,
    status: row.status,
  };
}

export function createContract(ledger: Ledger, input: CreateContractInput): ContractRecord {
  const id = createId('ctr');
  const clock = input.clock ?? systemClock;
  const createdAt = clock.now();
  const record: ContractRecord = {
    id,
    title: input.title,
    intent: input.intent ?? '',
    scope: input.scope ?? '',
    status: 'draft',
  };

  ledger.db
    .prepare(
      `
      insert into contracts
        (
          id,
          title,
          intent,
          scope,
          non_goals,
          assumptions,
          status,
          repo_path,
          branch,
          created_by,
          created_at
        )
      values
        (
          @id,
          @title,
          @intent,
          @scope,
          @nonGoals,
          @assumptions,
          @status,
          @repoPath,
          '',
          @createdBy,
          @createdAt
        )
    `,
    )
    .run({
      id,
      title: record.title,
      intent: record.intent,
      scope: record.scope,
      nonGoals: input.nonGoals ?? '',
      assumptions: input.assumptions ?? '',
      status: record.status,
      repoPath: path.resolve(ledger.cwd),
      createdBy: input.createdBy,
      createdAt,
    });

  recordEvent(ledger, {
    contractId: id,
    scopeType: 'contract',
    scopeId: id,
    actor: input.createdBy,
    eventType: 'contract_created',
    payload: {
      title: record.title,
      intent: record.intent,
      scope: record.scope,
    },
    clock,
  });

  return record;
}

export function acceptContract(ledger: Ledger, input: AcceptContractInput): ContractRecord {
  const clock = input.clock ?? systemClock;

  const result = ledger.db
    .prepare(
      `
      update contracts
      set
        status = 'accepted',
        accepted_at = @acceptedAt
      where id = @id
    `,
    )
    .run({
      id: input.contractId,
      acceptedAt: clock.now(),
    });

  if (result.changes === 0) {
    throw new Error(`Contract not found: ${input.contractId}`);
  }

  const record = getContract(ledger, input.contractId);
  if (record === undefined) {
    throw new Error(`Contract not found: ${input.contractId}`);
  }

  recordEvent(ledger, {
    contractId: input.contractId,
    scopeType: 'contract',
    scopeId: input.contractId,
    actor: input.actor,
    eventType: 'contract_accepted',
    payload: {},
    clock,
  });

  return record;
}

export function closeContract(ledger: Ledger, input: CloseContractInput): CloseContractResult {
  const clock = input.clock ?? systemClock;
  const existing = getContract(ledger, input.contractId);

  if (existing === undefined) {
    throw new Error(`Contract not found: ${input.contractId}`);
  }

  recordEvent(ledger, {
    contractId: input.contractId,
    scopeType: 'contract',
    scopeId: input.contractId,
    actor: input.actor,
    eventType: 'closeout_attempted',
    payload: {},
    clock,
  });

  const problems = assessCloseoutReadiness(ledger, input.contractId);

  if (problems.length > 0) {
    return { ok: false, problems };
  }

  const result = ledger.db
    .prepare(
      `
      update contracts
      set
        status = 'closed',
        closed_at = @closedAt
      where id = @id
        and status <> 'closed'
    `,
    )
    .run({
      id: input.contractId,
      closedAt: clock.now(),
    });

  if (result.changes > 0) {
    recordEvent(ledger, {
      contractId: input.contractId,
      scopeType: 'contract',
      scopeId: input.contractId,
      actor: input.actor,
      eventType: 'contract_closed',
      payload: {},
      clock,
    });
  }

  return { ok: true, problems: [] };
}

export function assessCloseoutReadiness(ledger: Ledger, contractId: string): string[] {
  const existing = getContract(ledger, contractId);

  if (existing === undefined) {
    throw new Error(`Contract not found: ${contractId}`);
  }

  const problems: string[] = [];

  if (!['accepted', 'active'].includes(existing.status)) {
    problems.push(`Contract must be accepted or active before closeout: ${existing.status}`);
  }

  const openCriteria = ledger.db
    .prepare(
      `
      select id, status
      from criteria
      where contract_id = ?
        and status not in ('satisfied', 'deferred', 'rejected')
      order by created_at, rowid
    `,
    )
    .all(contractId) as Array<{ id: string; status: string }>;

  if (openCriteria.length > 0) {
    const labels = openCriteria.map((criterion) => `${criterion.id} (${criterion.status})`);
    problems.push(`Pending criteria must be satisfied, deferred, or rejected: ${labels.join(', ')}`);
  }

  const weakTerminalCriteria = ledger.db
    .prepare(
      `
      select id, status
      from criteria
      where contract_id = ?
        and status in ('deferred', 'rejected')
        and (
          trim(coalesce(rationale, '')) = ''
          or trim(coalesce(residual_risk, '')) = ''
        )
      order by created_at, rowid
    `,
    )
    .all(contractId) as Array<{ id: string; status: string }>;

  if (weakTerminalCriteria.length > 0) {
    const labels = weakTerminalCriteria.map(
      (criterion) => `${criterion.id} (${criterion.status})`,
    );
    problems.push(
      `Deferred or rejected criteria require non-empty rationale and residual risk: ${labels.join(
        ', ',
      )}`,
    );
  }

  const unprovedCriteria = ledger.db
    .prepare(
      `
      select criteria.id
      from criteria
      where criteria.contract_id = ?
        and criteria.status = 'satisfied'
        and not exists (
          select 1
          from receipts
          where receipts.contract_id = criteria.contract_id
            and receipts.criterion_id = criteria.id
            and receipts.status = 'pass'
        )
      order by criteria.created_at, criteria.rowid
    `,
    )
    .all(contractId) as Array<{ id: string }>;

  if (unprovedCriteria.length > 0) {
    problems.push(
      `Satisfied criteria missing a passing receipt: ${unprovedCriteria
        .map((criterion) => criterion.id)
        .join(', ')}`,
    );
  }

  const unprovedVerifiers = ledger.db
    .prepare(
      `
      select id
      from verifiers
      where contract_id = ?
        and required = 1
        and not exists (
          select 1
          from receipts
          where receipts.contract_id = verifiers.contract_id
            and receipts.verifier_id = verifiers.id
            and receipts.status = 'pass'
        )
      order by created_at, rowid
    `,
    )
    .all(contractId) as Array<{ id: string }>;

  if (unprovedVerifiers.length > 0) {
    problems.push(
      `Required verifiers missing a passing verifier receipt: ${unprovedVerifiers
        .map((verifier) => verifier.id)
        .join(', ')}`,
    );
  }

  const pendingFailureModes = ledger.db
    .prepare(
      `
      select id
      from failure_modes
      where contract_id = ?
        and required = 1
        and status = 'pending'
      order by created_at, rowid
    `,
    )
    .all(contractId) as Array<{ id: string }>;

  if (pendingFailureModes.length > 0) {
    problems.push(
      `Required failure modes are still pending: ${pendingFailureModes
        .map((failureMode) => failureMode.id)
        .join(', ')}`,
    );
  }

  return problems;
}

export function getContract(ledger: Ledger, contractId: string): ContractRecord | undefined {
  const row = ledger.db
    .prepare(
      `
      select id, title, intent, scope, status
      from contracts
      where id = ?
    `,
    )
    .get(contractId) as ContractRow | undefined;

  return row === undefined ? undefined : toContractRecord(row);
}
