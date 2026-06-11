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

  ledger.db
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

  recordEvent(ledger, {
    contractId: input.contractId,
    scopeType: 'contract',
    scopeId: input.contractId,
    actor: input.actor,
    eventType: 'contract_accepted',
    payload: {},
    clock,
  });

  const record = getContract(ledger, input.contractId);
  if (record === undefined) {
    throw new Error(`Contract not found: ${input.contractId}`);
  }

  return record;
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
