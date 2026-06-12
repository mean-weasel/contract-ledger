import type Database from 'better-sqlite3';

export const SCHEMA_SQL = `
pragma foreign_keys = on;

create table if not exists schema_migrations (
  version integer primary key,
  applied_at text not null
);

create table if not exists goals (
  id text primary key,
  title text not null,
  intent text not null default '',
  status text not null,
  created_by text not null,
  created_at text not null,
  closed_at text
);

create table if not exists contracts (
  id text primary key,
  goal_id text references goals(id),
  title text not null,
  intent text not null default '',
  scope text not null default '',
  non_goals text not null default '',
  assumptions text not null default '',
  status text not null,
  repo_path text not null,
  branch text not null default '',
  created_by text not null,
  created_at text not null,
  accepted_at text,
  started_at text,
  closed_at text
);

create table if not exists amendments (
  id text primary key,
  contract_id text not null references contracts(id),
  reason text not null,
  changed_fields_json text not null,
  created_by text not null,
  created_at text not null
);

create table if not exists criteria (
  id text primary key,
  contract_id text not null references contracts(id),
  statement text not null,
  required_evidence_kind text not null,
  priority integer not null default 0,
  status text not null,
  rationale text,
  residual_risk text,
  created_at text not null,
  satisfied_at text,
  unique (id, contract_id)
);

create table if not exists verifier_adapters (
  id text primary key,
  name text not null unique,
  version text not null,
  kind text not null,
  status text not null,
  config_schema_json text not null,
  artifact_patterns_json text not null,
  receipt_mapper_json text not null,
  requires_judgment integer not null,
  source_type text not null default '',
  source_name text not null default '',
  source_version text not null default '',
  source_url text not null default '',
  repo_url text not null default '',
  docs_url text not null default '',
  homepage_url text not null default '',
  registry_url text not null default '',
  skill_refs_json text not null default '[]',
  created_at text not null,
  updated_at text not null
);

create table if not exists acceptance_profiles (
  id text primary key,
  adapter_id text not null references verifier_adapters(id),
  name text not null unique,
  description text not null,
  status text not null,
  default_config_json text not null,
  default_required_artifacts_json text not null,
  default_failure_modes_json text not null,
  created_at text not null,
  updated_at text not null
);

create table if not exists verifiers (
  id text primary key,
  contract_id text not null references contracts(id),
  criterion_id text,
  adapter_id text references verifier_adapters(id),
  name text not null,
  kind text not null,
  config_json text not null,
  required integer not null,
  created_at text not null,
  foreign key (criterion_id, contract_id) references criteria(id, contract_id),
  unique (id, contract_id)
);

create table if not exists todos (
  id text primary key,
  contract_id text not null references contracts(id),
  title text not null,
  description text not null default '',
  status text not null,
  linked_criterion_id text,
  claimed_by text,
  created_at text not null,
  completed_at text,
  foreign key (linked_criterion_id, contract_id) references criteria(id, contract_id),
  unique (id, contract_id)
);

create table if not exists failure_modes (
  id text primary key,
  contract_id text not null references contracts(id),
  failure_mode text not null,
  why_plausible text not null,
  linked_criterion_id text,
  check_description text not null,
  expected_verifier_id text,
  expected_proof_json text not null,
  resolution_rule text not null,
  status text not null,
  required integer not null,
  fewer_than_default_reason text,
  residual_risk text,
  created_at text not null,
  resolved_at text,
  foreign key (linked_criterion_id, contract_id) references criteria(id, contract_id),
  foreign key (expected_verifier_id, contract_id) references verifiers(id, contract_id),
  unique (id, contract_id)
);

create table if not exists receipts (
  id text primary key,
  contract_id text not null references contracts(id),
  criterion_id text,
  verifier_id text,
  todo_id text,
  disproof_attempt_id text,
  kind text not null,
  status text not null,
  summary text not null,
  command text,
  exit_code integer,
  stdout_excerpt text,
  stderr_excerpt text,
  adapter_metadata_json text,
  content_hash text,
  created_by text not null,
  created_at text not null,
  foreign key (criterion_id, contract_id) references criteria(id, contract_id),
  foreign key (verifier_id, contract_id) references verifiers(id, contract_id),
  foreign key (todo_id, contract_id) references todos(id, contract_id),
  foreign key (disproof_attempt_id, contract_id) references failure_modes(id, contract_id),
  unique (id, contract_id)
);

create table if not exists artifacts (
  id text primary key,
  contract_id text not null references contracts(id),
  path text not null,
  mime_type text not null default '',
  size_bytes integer not null,
  sha256 text not null,
  created_at text not null,
  unique (id, contract_id)
);

create table if not exists receipt_artifacts (
  receipt_id text not null,
  artifact_id text not null,
  contract_id text not null references contracts(id),
  foreign key (receipt_id, contract_id) references receipts(id, contract_id),
  foreign key (artifact_id, contract_id) references artifacts(id, contract_id),
  primary key (receipt_id, artifact_id)
);

create table if not exists command_invocations (
  id text primary key,
  actor text not null,
  session_id text,
  contract_id text,
  scope_type text not null,
  scope_id text,
  command text not null,
  subcommand text,
  argv_json text not null,
  cwd text not null,
  started_at text not null,
  completed_at text,
  exit_code integer,
  status text not null
);

create table if not exists events (
  id text primary key,
  command_invocation_id text references command_invocations(id),
  contract_id text,
  scope_type text not null,
  scope_id text,
  actor text not null,
  event_type text not null,
  payload_json text not null,
  created_at text not null
);

create index if not exists idx_contracts_goal_id on contracts(goal_id);
create index if not exists idx_criteria_contract_id on criteria(contract_id);
create index if not exists idx_verifiers_contract_id on verifiers(contract_id);
create index if not exists idx_todos_contract_id on todos(contract_id);
create index if not exists idx_failure_modes_contract_id on failure_modes(contract_id);
create index if not exists idx_receipts_contract_id on receipts(contract_id);
create index if not exists idx_artifacts_contract_id on artifacts(contract_id);
create index if not exists idx_command_invocations_contract_id on command_invocations(contract_id);
create index if not exists idx_events_command_invocation_id on events(command_invocation_id);
create index if not exists idx_events_contract_id on events(contract_id);
`;

type TableColumn = {
  name: string;
};

type ForeignKeyRow = {
  id: number;
  table: string;
  from: string;
};

function tableColumns(db: Database.Database, tableName: string): string[] {
  return db
    .prepare(`pragma table_info(${tableName})`)
    .all()
    .map((column) => (column as TableColumn).name);
}

function tableHasColumn(db: Database.Database, tableName: string, columnName: string): boolean {
  return tableColumns(db, tableName).includes(columnName);
}

function hasCompositeForeignKey(
  db: Database.Database,
  tableName: string,
  parentTableName: string,
  fromColumns: string[],
): boolean {
  const foreignKeys = db
    .prepare(`pragma foreign_key_list(${tableName})`)
    .all() as ForeignKeyRow[];
  const grouped = new Map<number, ForeignKeyRow[]>();

  for (const foreignKey of foreignKeys) {
    grouped.set(foreignKey.id, [...(grouped.get(foreignKey.id) ?? []), foreignKey]);
  }

  return [...grouped.values()].some((rows) => {
    const from = rows.map((row) => row.from).sort();
    return (
      rows.every((row) => row.table === parentTableName) &&
      from.length === fromColumns.length &&
      from.every((column, index) => column === [...fromColumns].sort()[index])
    );
  });
}

function needsContractScopedMigration(db: Database.Database): boolean {
  return (
    !hasCompositeForeignKey(db, 'verifiers', 'criteria', ['criterion_id', 'contract_id']) ||
    !hasCompositeForeignKey(db, 'todos', 'criteria', ['linked_criterion_id', 'contract_id']) ||
    !hasCompositeForeignKey(db, 'failure_modes', 'criteria', [
      'linked_criterion_id',
      'contract_id',
    ]) ||
    !hasCompositeForeignKey(db, 'failure_modes', 'verifiers', [
      'expected_verifier_id',
      'contract_id',
    ]) ||
    !hasCompositeForeignKey(db, 'receipts', 'criteria', ['criterion_id', 'contract_id']) ||
    !hasCompositeForeignKey(db, 'receipts', 'verifiers', ['verifier_id', 'contract_id']) ||
    !hasCompositeForeignKey(db, 'receipts', 'todos', ['todo_id', 'contract_id']) ||
    !hasCompositeForeignKey(db, 'receipts', 'failure_modes', [
      'disproof_attempt_id',
      'contract_id',
    ]) ||
    !tableHasColumn(db, 'receipt_artifacts', 'contract_id') ||
    !hasCompositeForeignKey(db, 'receipt_artifacts', 'receipts', [
      'receipt_id',
      'contract_id',
    ]) ||
    !hasCompositeForeignKey(db, 'receipt_artifacts', 'artifacts', [
      'artifact_id',
      'contract_id',
    ])
  );
}

const CONTRACT_SCOPED_MIGRATION_SQL = `
drop table if exists receipt_artifacts_new;
drop table if exists receipts_new;
drop table if exists failure_modes_new;
drop table if exists todos_new;
drop table if exists verifiers_new;

create unique index if not exists ux_migrate_criteria_id_contract_id on criteria(id, contract_id);
create unique index if not exists ux_migrate_verifiers_id_contract_id on verifiers(id, contract_id);
create unique index if not exists ux_migrate_todos_id_contract_id on todos(id, contract_id);
create unique index if not exists ux_migrate_failure_modes_id_contract_id on failure_modes(id, contract_id);
create unique index if not exists ux_migrate_receipts_id_contract_id on receipts(id, contract_id);
create unique index if not exists ux_migrate_artifacts_id_contract_id on artifacts(id, contract_id);

-- Invalid optional cross-contract links are nulled during copy; invalid receipt/artifact joins are omitted.
create table verifiers_new (
  id text primary key,
  contract_id text not null references contracts(id),
  criterion_id text,
  adapter_id text references verifier_adapters(id),
  name text not null,
  kind text not null,
  config_json text not null,
  required integer not null,
  created_at text not null,
  foreign key (criterion_id, contract_id) references criteria(id, contract_id),
  unique (id, contract_id)
);

insert into verifiers_new
  (id, contract_id, criterion_id, adapter_id, name, kind, config_json, required, created_at)
select
  id,
  contract_id,
  case
    when criterion_id is null then null
    when exists (
      select 1 from criteria
      where criteria.id = verifiers.criterion_id
        and criteria.contract_id = verifiers.contract_id
    ) then criterion_id
    else null
  end,
  adapter_id,
  name,
  kind,
  config_json,
  required,
  created_at
from verifiers;

create table todos_new (
  id text primary key,
  contract_id text not null references contracts(id),
  title text not null,
  description text not null default '',
  status text not null,
  linked_criterion_id text,
  claimed_by text,
  created_at text not null,
  completed_at text,
  foreign key (linked_criterion_id, contract_id) references criteria(id, contract_id),
  unique (id, contract_id)
);

insert into todos_new
  (
    id,
    contract_id,
    title,
    description,
    status,
    linked_criterion_id,
    claimed_by,
    created_at,
    completed_at
  )
select
  id,
  contract_id,
  title,
  description,
  status,
  case
    when linked_criterion_id is null then null
    when exists (
      select 1 from criteria
      where criteria.id = todos.linked_criterion_id
        and criteria.contract_id = todos.contract_id
    ) then linked_criterion_id
    else null
  end,
  claimed_by,
  created_at,
  completed_at
from todos;

create table failure_modes_new (
  id text primary key,
  contract_id text not null references contracts(id),
  failure_mode text not null,
  why_plausible text not null,
  linked_criterion_id text,
  check_description text not null,
  expected_verifier_id text,
  expected_proof_json text not null,
  resolution_rule text not null,
  status text not null,
  required integer not null,
  fewer_than_default_reason text,
  residual_risk text,
  created_at text not null,
  resolved_at text,
  foreign key (linked_criterion_id, contract_id) references criteria(id, contract_id),
  foreign key (expected_verifier_id, contract_id) references verifiers(id, contract_id),
  unique (id, contract_id)
);

insert into failure_modes_new
  (
    id,
    contract_id,
    failure_mode,
    why_plausible,
    linked_criterion_id,
    check_description,
    expected_verifier_id,
    expected_proof_json,
    resolution_rule,
    status,
    required,
    fewer_than_default_reason,
    residual_risk,
    created_at,
    resolved_at
  )
select
  id,
  contract_id,
  failure_mode,
  why_plausible,
  case
    when linked_criterion_id is null then null
    when exists (
      select 1 from criteria
      where criteria.id = failure_modes.linked_criterion_id
        and criteria.contract_id = failure_modes.contract_id
    ) then linked_criterion_id
    else null
  end,
  check_description,
  case
    when expected_verifier_id is null then null
    when exists (
      select 1 from verifiers
      where verifiers.id = failure_modes.expected_verifier_id
        and verifiers.contract_id = failure_modes.contract_id
    ) then expected_verifier_id
    else null
  end,
  expected_proof_json,
  resolution_rule,
  status,
  required,
  fewer_than_default_reason,
  residual_risk,
  created_at,
  resolved_at
from failure_modes;

create table receipts_new (
  id text primary key,
  contract_id text not null references contracts(id),
  criterion_id text,
  verifier_id text,
  todo_id text,
  disproof_attempt_id text,
  kind text not null,
  status text not null,
  summary text not null,
  command text,
  exit_code integer,
  stdout_excerpt text,
  stderr_excerpt text,
  adapter_metadata_json text,
  content_hash text,
  created_by text not null,
  created_at text not null,
  foreign key (criterion_id, contract_id) references criteria(id, contract_id),
  foreign key (verifier_id, contract_id) references verifiers(id, contract_id),
  foreign key (todo_id, contract_id) references todos(id, contract_id),
  foreign key (disproof_attempt_id, contract_id) references failure_modes(id, contract_id),
  unique (id, contract_id)
);

insert into receipts_new
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
select
  id,
  contract_id,
  case
    when criterion_id is null then null
    when exists (
      select 1 from criteria
      where criteria.id = receipts.criterion_id
        and criteria.contract_id = receipts.contract_id
    ) then criterion_id
    else null
  end,
  case
    when verifier_id is null then null
    when exists (
      select 1 from verifiers
      where verifiers.id = receipts.verifier_id
        and verifiers.contract_id = receipts.contract_id
    ) then verifier_id
    else null
  end,
  case
    when todo_id is null then null
    when exists (
      select 1 from todos
      where todos.id = receipts.todo_id
        and todos.contract_id = receipts.contract_id
    ) then todo_id
    else null
  end,
  case
    when disproof_attempt_id is null then null
    when exists (
      select 1 from failure_modes
      where failure_modes.id = receipts.disproof_attempt_id
        and failure_modes.contract_id = receipts.contract_id
    ) then disproof_attempt_id
    else null
  end,
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
from receipts;

create table receipt_artifacts_new (
  receipt_id text not null,
  artifact_id text not null,
  contract_id text not null references contracts(id),
  foreign key (receipt_id, contract_id) references receipts(id, contract_id),
  foreign key (artifact_id, contract_id) references artifacts(id, contract_id),
  primary key (receipt_id, artifact_id)
);

insert or ignore into receipt_artifacts_new
  (receipt_id, artifact_id, contract_id)
select
  receipt_artifacts.receipt_id,
  receipt_artifacts.artifact_id,
  receipts.contract_id
from receipt_artifacts
join receipts on receipts.id = receipt_artifacts.receipt_id
join artifacts on artifacts.id = receipt_artifacts.artifact_id
  and artifacts.contract_id = receipts.contract_id;

drop table receipt_artifacts;
drop table receipts;
drop table failure_modes;
drop table todos;
drop table verifiers;

alter table verifiers_new rename to verifiers;
alter table todos_new rename to todos;
alter table failure_modes_new rename to failure_modes;
alter table receipts_new rename to receipts;
alter table receipt_artifacts_new rename to receipt_artifacts;
`;

export function migrateContractScopedSchema(db: Database.Database): void {
  if (!needsContractScopedMigration(db)) {
    return;
  }

  db.pragma('foreign_keys = OFF');

  try {
    db.transaction(() => {
      db.exec(CONTRACT_SCOPED_MIGRATION_SQL);
    })();
  } finally {
    db.pragma('foreign_keys = ON');
  }

  const foreignKeyErrors = db.prepare('pragma foreign_key_check').all();
  if (foreignKeyErrors.length > 0) {
    throw new Error('Contract-scoped schema migration left foreign key violations');
  }
}

function addColumnIfMissing(db: Database.Database, tableName: string, columnSql: string): void {
  const columnName = columnSql.trim().split(/\s+/)[0];
  if (!tableHasColumn(db, tableName, columnName)) {
    db.prepare(`alter table ${tableName} add column ${columnSql}`).run();
  }
}

export function migrateAdapterManifestReferences(db: Database.Database): void {
  addColumnIfMissing(db, 'verifier_adapters', "source_type text not null default ''");
  addColumnIfMissing(db, 'verifier_adapters', "source_name text not null default ''");
  addColumnIfMissing(db, 'verifier_adapters', "source_version text not null default ''");
  addColumnIfMissing(db, 'verifier_adapters', "source_url text not null default ''");
  addColumnIfMissing(db, 'verifier_adapters', "repo_url text not null default ''");
  addColumnIfMissing(db, 'verifier_adapters', "docs_url text not null default ''");
  addColumnIfMissing(db, 'verifier_adapters', "homepage_url text not null default ''");
  addColumnIfMissing(db, 'verifier_adapters', "registry_url text not null default ''");
  addColumnIfMissing(db, 'verifier_adapters', "skill_refs_json text not null default '[]'");
}

function assertIsoTimestamp(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    throw new Error(`seedSql requires an ISO timestamp, received: ${value}`);
  }
}

export function seedSql(now: string): string {
  assertIsoTimestamp(now);

  return `
insert or ignore into verifier_adapters
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
    'adp_command_builtin',
    'command',
    '1',
    'command',
    'active',
    '{}',
    '[]',
    '{}',
    0,
    'builtin',
    '@mean-weasel/contract-ledger',
    '1',
    '',
    'https://github.com/mean-weasel/contract-ledger',
    'https://github.com/mean-weasel/contract-ledger#readme',
    '',
    'https://www.npmjs.com/package/@mean-weasel/contract-ledger',
    '[]',
    '${now}',
    '${now}'
  ),
  (
    'adp_limner_builtin',
    'limner',
    '1',
    'visual_fidelity',
    'active',
    '{"target":"string","mode":"string","url":"string","viewport":"string","storage_state":"string","full_page":"boolean"}',
    '["**/side-by-side.png","**/dom-metrics.json","**/reports/*.md",".limner/runs/*/manifest.json",".limner/runs/*/events.jsonl"]',
    '{"requiresJudgment":true}',
    1,
    'manual',
    'limner',
    '1',
    '',
    'https://github.com/neonwatty/limner',
    'https://github.com/neonwatty/limner#readme',
    '',
    '',
    '[]',
    '${now}',
    '${now}'
  );

insert or ignore into acceptance_profiles
  (
    id,
    adapter_id,
    name,
    description,
    status,
    default_config_json,
    default_required_artifacts_json,
    default_failure_modes_json,
    created_at,
    updated_at
  )
values
  (
    'prof_limner_visual_fidelity',
    'adp_limner_builtin',
    'limner-visual-fidelity',
    'Visual fidelity proof using Limner artifacts and agent judgment.',
    'active',
    '{}',
    '["side-by-side","dom-metrics","report"]',
    '["Reference matches but app diverges","Desktop matches but mobile breaks","Generated side-by-side exists but mismatches were not inspected"]',
    '${now}',
    '${now}'
  );
`;
}
