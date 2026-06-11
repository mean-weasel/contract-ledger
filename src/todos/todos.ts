import { recordEvent } from '../audit/audit.js';
import { createId } from '../core/ids.js';
import { systemClock, type Clock } from '../core/time.js';
import type { Ledger } from '../db/connection.js';

export type AddTodoInput = {
  contractId: string;
  title: string;
  description?: string;
  linkedCriterionId?: string;
  actor: string;
  clock?: Clock;
};

export type TodoRecord = {
  id: string;
  status: string;
};

export function addTodo(ledger: Ledger, input: AddTodoInput): TodoRecord {
  const id = createId('todo');
  const status = 'pending';
  const clock = input.clock ?? systemClock;

  ledger.db
    .prepare(
      `
      insert into todos
        (
          id,
          contract_id,
          title,
          description,
          status,
          linked_criterion_id,
          created_at
        )
      values
        (
          @id,
          @contractId,
          @title,
          @description,
          @status,
          @linkedCriterionId,
          @createdAt
        )
    `,
    )
    .run({
      id,
      contractId: input.contractId,
      title: input.title,
      description: input.description ?? '',
      status,
      linkedCriterionId: input.linkedCriterionId ?? null,
      createdAt: clock.now(),
    });

  recordEvent(ledger, {
    contractId: input.contractId,
    scopeType: 'todo',
    scopeId: id,
    actor: input.actor,
    eventType: 'todo_added',
    payload: {
      title: input.title,
      linkedCriterionId: input.linkedCriterionId ?? null,
    },
    clock,
  });

  return { id, status };
}
