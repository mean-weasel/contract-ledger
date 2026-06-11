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
  criterion_id text references criteria(id),
  adapter_id text references verifier_adapters(id),
  name text not null,
  kind text not null,
  config_json text not null,
  required integer not null,
  created_at text not null,
  unique (id, contract_id)
);

create table if not exists todos (
  id text primary key,
  contract_id text not null references contracts(id),
  title text not null,
  description text not null default '',
  status text not null,
  linked_criterion_id text references criteria(id),
  claimed_by text,
  created_at text not null,
  completed_at text,
  unique (id, contract_id)
);

create table if not exists failure_modes (
  id text primary key,
  contract_id text not null references contracts(id),
  failure_mode text not null,
  why_plausible text not null,
  linked_criterion_id text references criteria(id),
  check_description text not null,
  expected_verifier_id text references verifiers(id),
  expected_proof_json text not null,
  resolution_rule text not null,
  status text not null,
  required integer not null,
  fewer_than_default_reason text,
  residual_risk text,
  created_at text not null,
  resolved_at text,
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
  foreign key (disproof_attempt_id, contract_id) references failure_modes(id, contract_id)
);

create table if not exists artifacts (
  id text primary key,
  contract_id text not null references contracts(id),
  path text not null,
  mime_type text not null default '',
  size_bytes integer not null,
  sha256 text not null,
  created_at text not null
);

create table if not exists receipt_artifacts (
  receipt_id text not null references receipts(id),
  artifact_id text not null references artifacts(id),
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
