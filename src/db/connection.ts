import { mkdirSync } from 'node:fs';

import Database from 'better-sqlite3';

import { getWorkspacePaths } from '../core/fs.js';
import { systemClock, type Clock } from '../core/time.js';
import {
  migrateAdapterManifestReferences,
  migrateContractScopedSchema,
  SCHEMA_SQL,
  seedSql,
} from './schema.js';

export type Ledger = {
  db: Database.Database;
  cwd: string;
  ledgerPath: string;
  close(): void;
};

export type OpenLedgerInput = {
  cwd: string;
  clock?: Clock;
};

export function openLedger(input: OpenLedgerInput): Ledger {
  const clock = input.clock ?? systemClock;
  const paths = getWorkspacePaths(input.cwd);

  mkdirSync(paths.contractsDir, { recursive: true });
  mkdirSync(paths.artifactsDir, { recursive: true });
  mkdirSync(paths.exportsDir, { recursive: true });

  const db = new Database(paths.ledgerPath);
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA_SQL);
  migrateContractScopedSchema(db);
  migrateAdapterManifestReferences(db);
  db.exec(seedSql(clock.now()));

  return {
    db,
    cwd: paths.root,
    ledgerPath: paths.ledgerPath,
    close: () => db.close(),
  };
}
