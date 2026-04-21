create extension if not exists pgcrypto;

create table if not exists accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz default now()
);

create table if not exists licenses (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  plan text not null check (plan in ('Free','Pro','Enterprise')),
  seats int not null default 1,
  expires_at timestamptz not null,
  entitlements jsonb not null default '{}'::jsonb,
  status text not null default 'active',
  created_at timestamptz default now()
);

create table if not exists license_keys (
  id uuid primary key default gen_random_uuid(),
  license_id uuid not null references licenses(id) on delete cascade,
  key text not null unique,
  created_at timestamptz default now()
);

create table if not exists license_activations (
  id uuid primary key default gen_random_uuid(),
  license_id uuid not null references licenses(id) on delete cascade,
  user_id text,
  device_fingerprint text,
  created_at timestamptz default now()
);

create table if not exists usage_events (
  id uuid primary key default gen_random_uuid(),
  license_id uuid not null references licenses(id) on delete cascade,
  event text not null,
  quantity bigint not null,
  occurred_at timestamptz default now()
);
