import type { Ledger } from '../db/connection.js';

type ContractMarkdownRow = {
  id: string;
  title: string;
  intent: string;
  scope: string;
  status: string;
};

type CriterionMarkdownRow = {
  id: string;
  statement: string;
  required_evidence_kind: string;
  priority: number;
  status: string;
};

type ReceiptMarkdownRow = {
  id: string;
  criterion_id: string | null;
  kind: string;
  status: string;
  summary: string;
};

type FailureModeMarkdownRow = {
  id: string;
  linked_criterion_id: string | null;
  failure_mode: string;
  status: string;
  required: number;
};

function listOrNone(lines: string[]): string {
  if (lines.length === 0) {
    return '- None';
  }

  return lines.join('\n');
}

export function exportContractMarkdown(ledger: Ledger, contractId: string): string {
  const contract = ledger.db
    .prepare(
      `
      select id, title, intent, scope, status
      from contracts
      where id = ?
    `,
    )
    .get(contractId) as ContractMarkdownRow | undefined;

  if (contract === undefined) {
    throw new Error(`Contract not found: ${contractId}`);
  }

  const criteria = ledger.db
    .prepare(
      `
      select id, statement, required_evidence_kind, priority, status
      from criteria
      where contract_id = ?
      order by priority desc, created_at, rowid
    `,
    )
    .all(contractId) as CriterionMarkdownRow[];
  const receipts = ledger.db
    .prepare(
      `
      select id, criterion_id, kind, status, summary
      from receipts
      where contract_id = ?
      order by created_at, rowid
    `,
    )
    .all(contractId) as ReceiptMarkdownRow[];
  const failureModes = ledger.db
    .prepare(
      `
      select id, linked_criterion_id, failure_mode, status, required
      from failure_modes
      where contract_id = ?
      order by created_at, rowid
    `,
    )
    .all(contractId) as FailureModeMarkdownRow[];

  const criteriaLines = criteria.map(
    (criterion) =>
      `- ${criterion.id} [${criterion.status}] ${criterion.statement} (evidence: ${criterion.required_evidence_kind}, priority: ${criterion.priority})`,
  );
  const receiptLines = receipts.map((receipt) => {
    const criterion = receipt.criterion_id === null ? 'unlinked' : `criterion ${receipt.criterion_id}`;
    return `- ${receipt.id} [${receipt.status}] ${receipt.kind}: ${receipt.summary} (${criterion})`;
  });
  const failureModeLines = failureModes.map((failureMode) => {
    const criterion =
      failureMode.linked_criterion_id === null
        ? 'unlinked'
        : `criterion ${failureMode.linked_criterion_id}`;
    const required = failureMode.required === 1 ? 'required' : 'optional';
    return `- ${failureMode.id} [${failureMode.status}, ${required}] ${failureMode.failure_mode} (${criterion})`;
  });

  return [
    `# ${contract.title}`,
    '',
    `ID: ${contract.id}`,
    `Status: ${contract.status}`,
    `Intent: ${contract.intent}`,
    `Scope: ${contract.scope}`,
    '',
    '## Criteria',
    '',
    listOrNone(criteriaLines),
    '',
    '## Receipts',
    '',
    listOrNone(receiptLines),
    '',
    '## Failure Modes',
    '',
    listOrNone(failureModeLines),
    '',
  ].join('\n');
}
