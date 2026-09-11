create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;

create table public.market_sync_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null default 'brightdata' check (provider = 'brightdata'),
  name text not null,
  search_url text not null check (search_url ~* '^https://([a-z0-9-]+\.)?vinted\.(fr|com|be|de|es|it|nl|pt)/'),
  category text,
  estimated_resale_multiplier numeric(5,2) not null default 1.35 check (estimated_resale_multiplier between 1 and 5),
  buyer_fee numeric(10,2) not null default 0 check (buyer_fee >= 0),
  shipping numeric(10,2) not null default 0 check (shipping >= 0),
  interval_minutes integer not null default 15 check (interval_minutes between 5 and 1440),
  enabled boolean not null default true,
  last_run_at timestamptz,
  next_run_at timestamptz not null default now(),
  last_status text not null default 'ready' check (last_status in ('ready','running','pending','success','error','not_configured')),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, search_url)
);

create table public.market_sync_runs (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.market_sync_sources(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null default 'brightdata',
  snapshot_id text,
  status text not null default 'running' check (status in ('running','pending','success','error','not_configured')),
  fetched_count integer not null default 0,
  imported_count integer not null default 0,
  error_message text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create index market_sync_sources_due_idx on public.market_sync_sources (enabled, next_run_at);
create index market_sync_sources_user_idx on public.market_sync_sources (user_id);
create index market_sync_runs_source_idx on public.market_sync_runs (source_id, created_at desc);
create index market_sync_runs_user_idx on public.market_sync_runs (user_id, created_at desc);

alter table public.market_sync_sources enable row level security;
alter table public.market_sync_runs enable row level security;

create policy "market sync sources are readable by owner" on public.market_sync_sources
for select to authenticated using (auth.uid() = user_id);
create policy "market sync sources are insertable by owner" on public.market_sync_sources
for insert to authenticated with check (auth.uid() = user_id);
create policy "market sync sources are editable by owner" on public.market_sync_sources
for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "market sync sources are deletable by owner" on public.market_sync_sources
for delete to authenticated using (auth.uid() = user_id);
create policy "market sync runs are readable by owner" on public.market_sync_runs
for select to authenticated using (auth.uid() = user_id);

revoke all on public.market_sync_sources from anon;
revoke all on public.market_sync_runs from anon;
grant select, insert, update, delete on public.market_sync_sources to authenticated;
grant select on public.market_sync_runs to authenticated;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table private.market_sync_auth (
  singleton boolean primary key default true check (singleton),
  cron_token_hash text not null,
  created_at timestamptz not null default now()
);
revoke all on private.market_sync_auth from public, anon, authenticated;

create or replace function public.validate_market_sync_cron_token(candidate text)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select exists (
    select 1 from private.market_sync_auth
    where cron_token_hash = encode(extensions.digest(candidate, 'sha256'), 'hex')
  );
$$;
revoke all on function public.validate_market_sync_cron_token(text) from public, anon, authenticated;
grant execute on function public.validate_market_sync_cron_token(text) to service_role;

do $setup$
declare
  token text := encode(extensions.gen_random_bytes(32), 'hex');
  project_url text := 'https://uydivhuoajbnmjjfpeyg.supabase.co';
begin
  delete from vault.secrets where name in ('market_sync_cron_token', 'market_sync_project_url');
  perform vault.create_secret(token, 'market_sync_cron_token', 'ResellGO scheduled market sync authentication');
  perform vault.create_secret(project_url, 'market_sync_project_url', 'ResellGO Supabase project URL');
  insert into private.market_sync_auth(singleton, cron_token_hash)
  values (true, encode(extensions.digest(token, 'sha256'), 'hex'))
  on conflict (singleton) do update set cron_token_hash = excluded.cron_token_hash, created_at = now();
end
$setup$;

select cron.unschedule(jobid) from cron.job where jobname = 'resellgo-market-sync';
select cron.schedule(
  'resellgo-market-sync',
  '*/5 * * * *',
  $cron$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'market_sync_project_url') || '/functions/v1/market-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-token', (select decrypted_secret from vault.decrypted_secrets where name = 'market_sync_cron_token')
    ),
    body := '{"mode":"scheduled"}'::jsonb,
    timeout_milliseconds := 120000
  );
  $cron$
);

