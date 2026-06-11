import type { Ledger } from '../db/connection.js';

type WeakCloseoutRow = {
  contract_id: string;
  title: string;
  criterion_id: string;
  statement: string;
};

export function weakCloseoutReport(ledger: Ledger): string {
  const weakCriteria = ledger.db
    .prepare(
      `
      select
        contracts.id as contract_id,
        contracts.title as title,
        criteria.id as criterion_id,
        criteria.statement as statement
      from contracts
      join criteria on criteria.contract_id = contracts.id
      where contracts.status = 'closed'
        and criteria.status = 'satisfied'
        and not exists (
          select 1
          from receipts
          where receipts.contract_id = criteria.contract_id
            and receipts.criterion_id = criteria.id
            and receipts.status = 'pass'
        )
      order by contracts.created_at, contracts.rowid, criteria.created_at, criteria.rowid
    `,
    )
    .all() as WeakCloseoutRow[];

  if (weakCriteria.length === 0) {
    return '# Weak Closeout Report\n\n- None\n';
  }

  const lines = weakCriteria.map(
    (row) =>
      `- ${row.contract_id} ${row.title}: criterion ${row.criterion_id} missing passing receipt - ${row.statement}`,
  );

  return ['# Weak Closeout Report', '', ...lines, ''].join('\n');
}
