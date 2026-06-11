import { spawn } from 'node:child_process';
import path from 'node:path';

import { recordEvent } from '../audit/audit.js';
import { createId } from '../core/ids.js';
import { fileMetadata } from '../core/fs.js';
import { systemClock, type Clock } from '../core/time.js';
import type { Ledger } from '../db/connection.js';

export type ReceiptStatus = 'pass' | 'fail' | 'inconclusive';

export type AddReceiptInput = {
  contractId: string;
  criterionId?: string;
  verifierId?: string;
  todoId?: string;
  failureModeId?: string;
  kind: string;
  status: ReceiptStatus;
  summary: string;
  command?: string;
  exitCode?: number;
  stdoutExcerpt?: string;
  stderrExcerpt?: string;
  adapterMetadata?: unknown;
  contentHash?: string;
  actor: string;
  clock?: Clock;
};

export type ReceiptRecord = {
  id: string;
  status: ReceiptStatus;
  stdoutExcerpt?: string;
  stderrExcerpt?: string;
};

export type AttachArtifactInput = {
  contractId: string;
  receiptId: string;
  path: string;
  mimeType?: string;
  actor: string;
  clock?: Clock;
};

export type ArtifactRecord = {
  id: string;
  sha256: string;
};

export type RunCommandReceiptInput = {
  contractId: string;
  criterionId?: string;
  verifierId?: string;
  todoId?: string;
  failureModeId?: string;
  command: string;
  args?: string[];
  summary?: string;
  actor: string;
  adapterMetadata?: unknown;
  clock?: Clock;
};

type ReceiptContractRow = {
  contract_id: string;
};

type CommandResult = {
  exitCode: number;
  stdoutExcerpt: string;
  stderrExcerpt: string;
};

const RECEIPT_STATUSES: ReadonlySet<string> = new Set(['pass', 'fail', 'inconclusive']);
const EXCERPT_LIMIT = 4000;

function assertReceiptStatus(status: unknown): asserts status is ReceiptStatus {
  if (typeof status !== 'string' || !RECEIPT_STATUSES.has(status)) {
    throw new Error(`Invalid receipt status: ${String(status)}`);
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

  throw new Error('adapterMetadata must be JSON-serializable without lossy values');
}

function stringifyAdapterMetadata(adapterMetadata: unknown): string | null {
  if (adapterMetadata === undefined) {
    return null;
  }

  assertJsonSerializable(adapterMetadata);
  return JSON.stringify(adapterMetadata);
}

function excerpt(value: string): string {
  return value.slice(0, EXCERPT_LIMIT);
}

function appendExcerpt(current: string, chunk: string): string {
  if (current.length >= EXCERPT_LIMIT) {
    return current;
  }

  return excerpt(current + chunk);
}

function commandText(command: string, args: string[]): string {
  return [command, ...args].join(' ');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function runCommand(input: { cwd: string; command: string; args: string[] }): Promise<CommandResult> {
  return await new Promise((resolve) => {
    const child = spawn(input.command, input.args, {
      cwd: input.cwd,
      shell: false,
    });
    let stdoutExcerpt = '';
    let stderrExcerpt = '';
    let settled = false;

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdoutExcerpt = appendExcerpt(stdoutExcerpt, chunk);
    });
    child.stderr.on('data', (chunk: string) => {
      stderrExcerpt = appendExcerpt(stderrExcerpt, chunk);
    });

    child.on('error', (error) => {
      settled = true;
      resolve({
        exitCode: 1,
        stdoutExcerpt,
        stderrExcerpt: appendExcerpt(stderrExcerpt, error.message),
      });
    });

    child.on('close', (code) => {
      if (settled) {
        return;
      }

      resolve({
        exitCode: code ?? 1,
        stdoutExcerpt,
        stderrExcerpt,
      });
    });
  });
}

export function addReceipt(ledger: Ledger, input: AddReceiptInput): ReceiptRecord {
  assertReceiptStatus(input.status);

  const id = createId('rec');
  const clock = input.clock ?? systemClock;
  const createdAt = clock.now();
  const adapterMetadataJson = stringifyAdapterMetadata(input.adapterMetadata);
  const stdoutExcerpt = input.stdoutExcerpt === undefined ? null : excerpt(input.stdoutExcerpt);
  const stderrExcerpt = input.stderrExcerpt === undefined ? null : excerpt(input.stderrExcerpt);

  ledger.db
    .prepare(
      `
      insert into receipts
        (
          id,
          contract_id,
          criterion_id,
          verifier_id,
          todo_id,
          disproof_attempt_id,
          kind,
          status,
          summary,
          command,
          exit_code,
          stdout_excerpt,
          stderr_excerpt,
          adapter_metadata_json,
          content_hash,
          created_by,
          created_at
        )
      values
        (
          @id,
          @contractId,
          @criterionId,
          @verifierId,
          @todoId,
          @failureModeId,
          @kind,
          @status,
          @summary,
          @command,
          @exitCode,
          @stdoutExcerpt,
          @stderrExcerpt,
          @adapterMetadataJson,
          @contentHash,
          @createdBy,
          @createdAt
        )
    `,
    )
    .run({
      id,
      contractId: input.contractId,
      criterionId: input.criterionId ?? null,
      verifierId: input.verifierId ?? null,
      todoId: input.todoId ?? null,
      failureModeId: input.failureModeId ?? null,
      kind: input.kind,
      status: input.status,
      summary: input.summary,
      command: input.command ?? null,
      exitCode: input.exitCode ?? null,
      stdoutExcerpt,
      stderrExcerpt,
      adapterMetadataJson,
      contentHash: input.contentHash ?? null,
      createdBy: input.actor,
      createdAt,
    });

  recordEvent(ledger, {
    contractId: input.contractId,
    scopeType: 'receipt',
    scopeId: id,
    actor: input.actor,
    eventType: 'receipt_created',
    payload: {
      kind: input.kind,
      status: input.status,
      criterionId: input.criterionId ?? null,
      verifierId: input.verifierId ?? null,
      todoId: input.todoId ?? null,
      failureModeId: input.failureModeId ?? null,
    },
    clock,
  });

  return {
    id,
    status: input.status,
    stdoutExcerpt: stdoutExcerpt ?? undefined,
    stderrExcerpt: stderrExcerpt ?? undefined,
  };
}

export async function attachArtifact(
  ledger: Ledger,
  input: AttachArtifactInput,
): Promise<ArtifactRecord> {
  const receipt = ledger.db
    .prepare(
      `
      select contract_id
      from receipts
      where id = ? and contract_id = ?
    `,
    )
    .get(input.receiptId, input.contractId) as ReceiptContractRow | undefined;

  if (receipt === undefined) {
    throw new Error(`Receipt not found for contract: ${input.receiptId}`);
  }

  const clock = input.clock ?? systemClock;
  const id = createId('art');
  const absolutePath = path.resolve(ledger.cwd, input.path);
  const metadata = await fileMetadata(absolutePath);

  const insertArtifact = ledger.db.transaction(() => {
    ledger.db
      .prepare(
        `
        insert into artifacts
          (
            id,
            contract_id,
            path,
            mime_type,
            size_bytes,
            sha256,
            created_at
          )
        values
          (
            @id,
            @contractId,
            @path,
            @mimeType,
            @sizeBytes,
            @sha256,
            @createdAt
          )
      `,
      )
      .run({
        id,
        contractId: input.contractId,
        path: absolutePath,
        mimeType: input.mimeType ?? '',
        sizeBytes: metadata.sizeBytes,
        sha256: metadata.sha256,
        createdAt: clock.now(),
      });

    ledger.db
      .prepare(
        `
        insert into receipt_artifacts
          (
            receipt_id,
            artifact_id,
            contract_id
          )
        values
          (
            @receiptId,
            @artifactId,
            @contractId
          )
      `,
      )
      .run({
        receiptId: input.receiptId,
        artifactId: id,
        contractId: input.contractId,
      });

    recordEvent(ledger, {
      contractId: input.contractId,
      scopeType: 'artifact',
      scopeId: id,
      actor: input.actor,
      eventType: 'artifact_attached',
      payload: {
        receiptId: input.receiptId,
        path: absolutePath,
        sha256: metadata.sha256,
      },
      clock,
    });
  });

  insertArtifact();

  return {
    id,
    sha256: metadata.sha256,
  };
}

export async function runCommandReceipt(
  ledger: Ledger,
  input: RunCommandReceiptInput,
): Promise<ReceiptRecord> {
  const clock = input.clock ?? systemClock;
  const args = input.args ?? [];
  const command = commandText(input.command, args);

  stringifyAdapterMetadata(input.adapterMetadata);

  recordEvent(ledger, {
    contractId: input.contractId,
    scopeType: 'verifier',
    scopeId: input.verifierId ?? input.contractId,
    actor: input.actor,
    eventType: 'verifier_run_started',
    payload: {
      command,
      verifierId: input.verifierId ?? null,
    },
    clock,
  });

  const result = await runCommand({
    cwd: ledger.cwd,
    command: input.command,
    args,
  });
  const status: ReceiptStatus = result.exitCode === 0 ? 'pass' : 'fail';
  let receipt: ReceiptRecord;

  try {
    receipt = addReceipt(ledger, {
      contractId: input.contractId,
      criterionId: input.criterionId,
      verifierId: input.verifierId,
      todoId: input.todoId,
      failureModeId: input.failureModeId,
      kind: 'command',
      status,
      summary: input.summary ?? `Command exited ${result.exitCode}`,
      command,
      exitCode: result.exitCode,
      stdoutExcerpt: result.stdoutExcerpt,
      stderrExcerpt: result.stderrExcerpt,
      adapterMetadata: input.adapterMetadata,
      actor: input.actor,
      clock,
    });
  } catch (error) {
    recordEvent(ledger, {
      contractId: input.contractId,
      scopeType: 'verifier',
      scopeId: input.verifierId ?? input.contractId,
      actor: input.actor,
      eventType: 'verifier_run_failed',
      payload: {
        verifierId: input.verifierId ?? null,
        exitCode: result.exitCode,
        status: 'fail',
        errorMessage: errorMessage(error),
      },
      clock,
    });
    throw error;
  }

  recordEvent(ledger, {
    contractId: input.contractId,
    scopeType: 'verifier',
    scopeId: input.verifierId ?? input.contractId,
    actor: input.actor,
    eventType: status === 'pass' ? 'verifier_run_completed' : 'verifier_run_failed',
    payload: {
      receiptId: receipt.id,
      verifierId: input.verifierId ?? null,
      exitCode: result.exitCode,
      status,
    },
    clock,
  });

  return {
    id: receipt.id,
    status,
    stdoutExcerpt: result.stdoutExcerpt,
    stderrExcerpt: result.stderrExcerpt,
  };
}
