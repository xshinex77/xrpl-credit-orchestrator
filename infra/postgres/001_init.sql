create extension if not exists pgcrypto;

create table if not exists auth_users (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  password_hash text not null,
  role text not null check (role in ('platform_admin','risk_operator','ledger_operator','auditor','lender','borrower')),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists parties (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid references auth_users(id),
  role text not null check (role in ('borrower','lender','operator','broker_owner')),
  legal_name text not null,
  country_code text,
  status text not null,
  created_at timestamptz not null default now()
);
create unique index if not exists idx_parties_auth_user on parties (auth_user_id) where auth_user_id is not null;

create table if not exists party_wallets (
  id uuid primary key default gen_random_uuid(),
  party_id uuid not null references parties(id),
  xrpl_address text not null unique,
  wallet_type text not null,
  is_primary boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists credentials (
  id uuid primary key default gen_random_uuid(),
  party_id uuid not null references parties(id),
  credential_type text not null,
  issuer_address text not null,
  xrpl_credential_id text,
  status text not null,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists permissioned_domains (
  id uuid primary key default gen_random_uuid(),
  domain_name text not null,
  xrpl_domain_id text unique,
  status text not null,
  created_at timestamptz not null default now()
);

create table if not exists vaults (
  id uuid primary key default gen_random_uuid(),
  xrpl_vault_id text unique,
  owner_address text not null,
  asset_type text not null,
  asset_code text,
  issuer_address text,
  asset_mpt_issuance_id text,
  is_private boolean not null,
  permissioned_domain_id uuid references permissioned_domains(id),
  status text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists vault_positions (
  id uuid primary key default gen_random_uuid(),
  vault_id uuid not null references vaults(id),
  lender_party_id uuid references parties(id),
  lender_address text,
  shares_numeric numeric(38,18) not null default 0,
  deposited_amount numeric(38,18) not null default 0,
  withdrawn_amount numeric(38,18) not null default 0,
  updated_at timestamptz not null default now(),
  unique (vault_id, lender_address)
);

create table if not exists loan_brokers (
  id uuid primary key default gen_random_uuid(),
  xrpl_loan_broker_id text unique,
  vault_id uuid not null references vaults(id),
  owner_address text not null,
  management_fee_rate_ppm bigint,
  debt_maximum numeric(38,18) not null default 0,
  cover_rate_minimum_ppm bigint,
  cover_rate_liquidation_ppm bigint,
  status text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists first_loss_cover_ledger (
  id uuid primary key default gen_random_uuid(),
  loan_broker_id uuid not null references loan_brokers(id),
  entry_type text not null,
  amount numeric(38,18) not null,
  asset_ref text not null,
  xrpl_tx_hash text,
  created_at timestamptz not null default now()
);

create table if not exists loans (
  id uuid primary key default gen_random_uuid(),
  application_id uuid,
  xrpl_loan_id text unique,
  xrpl_loan_seq bigint,
  loan_broker_id uuid references loan_brokers(id),
  borrower_party_id uuid references parties(id),
  borrower_address text,
  principal numeric(38,18) not null,
  interest_rate_ppm bigint not null,
  payment_total integer not null,
  payment_interval_seconds integer not null,
  grace_period_seconds integer not null default 0,
  loan_origination_fee numeric(38,18) not null default 0,
  loan_service_fee numeric(38,18) not null default 0,
  status text not null,
  cosign_packet_json jsonb,
  partially_signed_tx_json jsonb,
  due_at timestamptz,
  impaired_at timestamptz,
  defaulted_at timestamptz,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists evidence_events (
  id uuid primary key default gen_random_uuid(),
  chain_scope text not null,
  aggregate_type text not null,
  aggregate_id uuid not null,
  event_type text not null,
  payload jsonb not null,
  payload_hash text not null,
  prev_hash text,
  created_at timestamptz not null default now()
);
create index if not exists idx_evidence_scope_created_at on evidence_events (chain_scope, created_at);

create table if not exists tx_outbox (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  status text not null,
  aggregate_type text not null,
  aggregate_id uuid not null,
  dedupe_key text,
  requested_by_user uuid,
  tx_json jsonb not null,
  submitted_tx_json jsonb,
  tx_hash text,
  tx_result_json jsonb,
  metadata jsonb not null default '{}'::jsonb,
  error_text text,
  attempts integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_tx_outbox_status_created_at on tx_outbox (status, created_at);
create unique index if not exists idx_tx_outbox_dedupe on tx_outbox (aggregate_type, aggregate_id, kind, dedupe_key) where dedupe_key is not null;

create table if not exists ledger_checkpoints (
  stream_name text primary key,
  last_validated_ledger bigint not null,
  updated_at timestamptz not null default now()
);

create table if not exists reconciliation_runs (
  id uuid primary key default gen_random_uuid(),
  job_name text not null,
  target_type text not null,
  target_id uuid not null,
  outcome text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists xrpl_transactions (
  tx_hash text primary key,
  tx_type text not null,
  ledger_index bigint,
  result_code text,
  account text,
  counterparty text,
  observed_at timestamptz not null default now(),
  raw_json jsonb not null
);

create table if not exists xrpl_account_sequences (
  account text primary key,
  next_sequence bigint not null,
  lease_expires_at timestamptz not null default now() + interval '30 seconds',
  last_synced_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
