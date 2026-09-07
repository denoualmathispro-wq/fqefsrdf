create table if not exists public.market_opportunities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source text not null default 'manual_link' check (source in ('manual_link','csv','authorized_api')),
  external_id text,
  external_url text,
  title text not null check (char_length(title) between 1 and 180),
  brand text,
  category text not null,
  size text,
  item_condition text,
  buy_price numeric(12,2) not null check (buy_price >= 0),
  buyer_fee numeric(12,2) not null default 0 check (buyer_fee >= 0),
  shipping numeric(12,2) not null default 0 check (shipping >= 0),
  estimated_resale numeric(12,2) not null check (estimated_resale >= 0),
  seller_fee numeric(12,2) not null default 0 check (seller_fee >= 0),
  total_cost numeric(12,2) generated always as (buy_price + buyer_fee + shipping) stored,
  net_margin numeric(12,2) generated always as (estimated_resale - buy_price - buyer_fee - shipping - seller_fee) stored,
  roi numeric(10,2) generated always as (
    case when buy_price + buyer_fee + shipping > 0
      then ((estimated_resale - buy_price - buyer_fee - shipping - seller_fee) / (buy_price + buyer_fee + shipping)) * 100
      else 0 end
  ) stored,
  confidence_score smallint not null default 50 check (confidence_score between 0 and 100),
  demand_score smallint not null default 50 check (demand_score between 0 and 100),
  opportunity_score smallint generated always as (
    least(100, greatest(0, round(
      least(greatest(
        case when buy_price + buyer_fee + shipping > 0
          then ((estimated_resale - buy_price - buyer_fee - shipping - seller_fee) / (buy_price + buyer_fee + shipping)) * 100
          else 0 end,
        0), 120) / 120 * 55
      + confidence_score * 0.25
      + demand_score * 0.20
    )))::smallint
  ) stored,
  resale_days_estimate integer check (resale_days_estimate is null or resale_days_estimate between 0 and 365),
  status text not null default 'new' check (status in ('new','watching','purchased','sold','ignored','expired')),
  observed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, source, external_id)
);

create table if not exists public.market_watchlists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  keywords text,
  category text,
  max_total_cost numeric(12,2) check (max_total_cost is null or max_total_cost >= 0),
  min_margin numeric(12,2) check (min_margin is null or min_margin >= 0),
  min_roi numeric(10,2) check (min_roi is null or min_roi >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.market_opportunities enable row level security;
alter table public.market_watchlists enable row level security;

grant select, insert, update, delete on public.market_opportunities to authenticated;
grant select, insert, update, delete on public.market_watchlists to authenticated;

create policy market_opportunities_select on public.market_opportunities for select to authenticated
using ((select auth.uid()) = user_id or (select private.is_admin()));
create policy market_opportunities_insert on public.market_opportunities for insert to authenticated
with check ((select auth.uid()) = user_id);
create policy market_opportunities_update on public.market_opportunities for update to authenticated
using ((select auth.uid()) = user_id or (select private.is_admin()))
with check ((select auth.uid()) = user_id or (select private.is_admin()));
create policy market_opportunities_delete on public.market_opportunities for delete to authenticated
using ((select auth.uid()) = user_id or (select private.is_admin()));

create policy market_watchlists_select on public.market_watchlists for select to authenticated
using ((select auth.uid()) = user_id or (select private.is_admin()));
create policy market_watchlists_insert on public.market_watchlists for insert to authenticated
with check ((select auth.uid()) = user_id);
create policy market_watchlists_update on public.market_watchlists for update to authenticated
using ((select auth.uid()) = user_id or (select private.is_admin()))
with check ((select auth.uid()) = user_id or (select private.is_admin()));
create policy market_watchlists_delete on public.market_watchlists for delete to authenticated
using ((select auth.uid()) = user_id or (select private.is_admin()));

create index market_opportunities_user_score_idx on public.market_opportunities(user_id, opportunity_score desc, observed_at desc);
create index market_opportunities_user_status_idx on public.market_opportunities(user_id, status, observed_at desc);
create index market_opportunities_brand_category_idx on public.market_opportunities(brand, category);
create index market_watchlists_user_active_idx on public.market_watchlists(user_id, active) where active = true;
