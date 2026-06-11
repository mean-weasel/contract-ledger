import { AsyncLocalStorage } from 'node:async_hooks';

import { createId } from '../core/ids.js';
import { redactArgv } from '../core/redact.js';
import { systemClock, type Clock } from '../core/time.js';
import type { Ledger } from '../db/connection.js';

type AuditContext = {
  commandInvocationId: string;
};

const auditContext = new AsyncLocalStorage<AuditContext>();

export type CommandInvocationInput = {
  actor: string;
  sessionId?: string;
  contractId?: string;
  scopeType: string;
  scopeId?: string;
  command: string;
  subcommand?: string;
  argv: string[];
  cwd: string;
  clock?: Clock;
};

export type CompleteCommandInvocationInput = {
  exitCode: number;
  status: 'ok' | 'failed';
  clock?: Clock;
};

export type RecordEventInput = {
  commandInvocationId?: string;
  contractId?: string;
  scopeType: string;
  scopeId?: string;
  actor: string;
  eventType: string;
  payload: Record<string, unknown>;
  clock?: Clock;
};

export function createCommandInvocation(
  ledger: Ledger,
  input: CommandInvocationInput,
): { id: string } {
  const id = createId('cmd');
  const clock = input.clock ?? systemClock;

  ledger.db
    .prepare(
      `
      insert into command_invocations
        (
          id,
          actor,
          session_id,
          contract_id,
          scope_type,
          scope_id,
          command,
          subcommand,
          argv_json,
          cwd,
          started_at,
          status
        )
      values
        (
          @id,
          @actor,
          @sessionId,
          @contractId,
          @scopeType,
          @scopeId,
          @command,
          @subcommand,
          @argvJson,
          @cwd,
          @startedAt,
          'running'
        )
    `,
    )
    .run({
      id,
      actor: input.actor,
      sessionId: input.sessionId ?? null,
      contractId: input.contractId ?? null,
      scopeType: input.scopeType,
      scopeId: input.scopeId ?? null,
      command: input.command,
      subcommand: input.subcommand ?? null,
      argvJson: JSON.stringify(redactArgv(input.argv)),
      cwd: input.cwd,
      startedAt: clock.now(),
    });

  return { id };
}

export function completeCommandInvocation(
  ledger: Ledger,
  id: string,
  input: CompleteCommandInvocationInput,
): void {
  const clock = input.clock ?? systemClock;

  ledger.db
    .prepare(
      `
      update command_invocations
      set
        completed_at = @completedAt,
        exit_code = @exitCode,
        status = @status
      where id = @id
    `,
    )
    .run({
      id,
      completedAt: clock.now(),
      exitCode: input.exitCode,
      status: input.status,
    });
}

export async function withAuditContext<T>(
  commandInvocationId: string,
  fn: () => T | Promise<T>,
): Promise<T> {
  return await auditContext.run({ commandInvocationId }, fn);
}

export function recordEvent(ledger: Ledger, input: RecordEventInput): { id: string } {
  const id = createId('evt');
  const clock = input.clock ?? systemClock;

  ledger.db
    .prepare(
      `
      insert into events
        (
          id,
          command_invocation_id,
          contract_id,
          scope_type,
          scope_id,
          actor,
          event_type,
          payload_json,
          created_at
        )
      values
        (
          @id,
          @commandInvocationId,
          @contractId,
          @scopeType,
          @scopeId,
          @actor,
          @eventType,
          @payloadJson,
          @createdAt
        )
    `,
    )
    .run({
      id,
      commandInvocationId:
        input.commandInvocationId ?? auditContext.getStore()?.commandInvocationId ?? null,
      contractId: input.contractId ?? null,
      scopeType: input.scopeType,
      scopeId: input.scopeId ?? null,
      actor: input.actor,
      eventType: input.eventType,
      payloadJson: JSON.stringify(input.payload),
      createdAt: clock.now(),
    });

  return { id };
}
