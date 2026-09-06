create schema if not exists private;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null default 'Compte',
  preferences jsonb not null default '{}'::jsonb,
  onboarding_completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.access_control (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'user' check (role in ('user','admin')),
  plan text not null default 'free' check (plan in ('free','starter','pro','elite')),
  status text not null default 'active' check (status in ('active','suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function private.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.access_control
    where user_id = (select auth.uid()) and role = 'admin' and status = 'active'
  );
$$;
revoke all on function private.is_admin() from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.is_admin() to authenticated;

create table public.listings (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references auth.users(id) on delete cascade,
  source text not null default 'manual' check (source in ('manual','csv')),
  title text not null check (char_length(title) between 1 and 160),
  brand text, category text not null, size text,
  buy_price numeric(12,2) not null default 0 check (buy_price >= 0),
  market_price numeric(12,2) not null default 0 check (market_price >= 0),
  fees numeric(12,2) not null default 0 check (fees >= 0),
  shipping numeric(12,2) not null default 0 check (shipping >= 0),
  status text not null default 'active' check (status in ('active','sold','archived')),
  image_url text, external_url text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table public.favorites (
  user_id uuid not null references auth.users(id) on delete cascade,
  listing_id uuid not null references public.listings(id) on delete cascade,
  created_at timestamptz not null default now(), primary key(user_id,listing_id)
);

create table public.analyses (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  title text not null, buy_price numeric(12,2) not null default 0, sell_price numeric(12,2) not null default 0,
  fees numeric(12,2) not null default 0, shipping numeric(12,2) not null default 0,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table public.alerts (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  name text not null, category text, keywords text, max_price numeric(12,2), min_margin numeric(12,2),
  active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  title text not null, body text, type text not null default 'info', listing_id uuid references public.listings(id) on delete cascade,
  read_at timestamptz, created_at timestamptz not null default now()
);

create table public.imports (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  filename text not null, row_count integer not null default 0 check(row_count >= 0), status text not null default 'completed',
  created_at timestamptz not null default now()
);

create table public.waitlist (
  id uuid primary key default gen_random_uuid(), email text not null, first_name text, level text, category text,
  created_at timestamptz not null default now()
);
create unique index waitlist_email_uidx on public.waitlist(lower(email));

create table public.audit_logs (
  id bigint generated always as identity primary key, actor_id uuid references auth.users(id) on delete set null,
  action text not null, target_user_id uuid references auth.users(id) on delete set null,
  details jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.access_control enable row level security;
alter table public.listings enable row level security;
alter table public.favorites enable row level security;
alter table public.analyses enable row level security;
alter table public.alerts enable row level security;
alter table public.notifications enable row level security;
alter table public.imports enable row level security;
alter table public.waitlist enable row level security;
alter table public.audit_logs enable row level security;

grant select,update on public.profiles to authenticated;
grant select,update on public.access_control to authenticated;
grant select,insert,update,delete on public.listings,public.favorites,public.analyses,public.alerts,public.notifications,public.imports to authenticated;
grant insert on public.waitlist to anon,authenticated;
grant select on public.waitlist to authenticated;
grant insert,select on public.audit_logs to authenticated;

create policy profiles_read on public.profiles for select to authenticated using (id=(select auth.uid()) or (select private.is_admin()));
create policy profiles_update on public.profiles for update to authenticated using (id=(select auth.uid())) with check (id=(select auth.uid()));
create policy access_read on public.access_control for select to authenticated using (user_id=(select auth.uid()) or (select private.is_admin()));
create policy access_admin_update on public.access_control for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy listings_read on public.listings for select to authenticated using (created_by=(select auth.uid()) or (select private.is_admin()));
create policy listings_insert on public.listings for insert to authenticated with check (created_by=(select auth.uid()));
create policy listings_update on public.listings for update to authenticated using (created_by=(select auth.uid()) or (select private.is_admin())) with check (created_by=(select auth.uid()) or (select private.is_admin()));
create policy listings_delete on public.listings for delete to authenticated using (created_by=(select auth.uid()) or (select private.is_admin()));
create policy favorites_all on public.favorites for all to authenticated using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));
create policy analyses_all on public.analyses for all to authenticated using (user_id=(select auth.uid()) or (select private.is_admin())) with check (user_id=(select auth.uid()));
create policy alerts_all on public.alerts for all to authenticated using (user_id=(select auth.uid()) or (select private.is_admin())) with check (user_id=(select auth.uid()));
create policy notifications_read on public.notifications for select to authenticated using (user_id=(select auth.uid()) or (select private.is_admin()));
create policy notifications_update on public.notifications for update to authenticated using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));
create policy imports_all on public.imports for all to authenticated using (user_id=(select auth.uid()) or (select private.is_admin())) with check (user_id=(select auth.uid()));
create policy waitlist_insert on public.waitlist for insert to anon,authenticated with check (email is not null);
create policy waitlist_admin_read on public.waitlist for select to authenticated using ((select private.is_admin()));
create policy audit_insert on public.audit_logs for insert to authenticated with check (actor_id=(select auth.uid()) and (select private.is_admin()));
create policy audit_admin_read on public.audit_logs for select to authenticated using ((select private.is_admin()));

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.profiles(id,email,full_name) values(new.id,coalesce(new.email,''),coalesce(new.raw_user_meta_data->>'full_name','Compte'));
 insert into public.access_control(user_id,role,plan,status) values(new.id,case when lower(coalesce(new.email,''))='denoual.mathispro@gmail.com' then 'admin' else 'user' end,'free','active');
 return new;
end $$;
revoke all on function public.handle_new_user() from public,anon,authenticated;
grant execute on function public.handle_new_user() to supabase_auth_admin;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

create index listings_created_by_idx on public.listings(created_by,created_at desc);
create index analyses_user_idx on public.analyses(user_id,created_at desc);
create index alerts_user_idx on public.alerts(user_id,created_at desc);
create index notifications_user_idx on public.notifications(user_id,created_at desc);
create index favorites_listing_idx on public.favorites(listing_id);
create index imports_user_idx on public.imports(user_id);
create index notifications_listing_idx on public.notifications(listing_id);
create index audit_logs_actor_idx on public.audit_logs(actor_id);
create index audit_logs_target_user_idx on public.audit_logs(target_user_id);
