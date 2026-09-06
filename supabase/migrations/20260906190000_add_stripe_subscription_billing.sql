alter table public.access_control
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_subscription_id text,
  add column if not exists stripe_price_id text,
  add column if not exists subscription_status text not null default 'inactive',
  add column if not exists current_period_end timestamptz;

create unique index if not exists access_control_stripe_customer_uidx
  on public.access_control(stripe_customer_id) where stripe_customer_id is not null;
create unique index if not exists access_control_stripe_subscription_uidx
  on public.access_control(stripe_subscription_id) where stripe_subscription_id is not null;

create table if not exists public.billing_events (
  id text primary key,
  event_type text not null,
  processed_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb
);
alter table public.billing_events enable row level security;
revoke all on public.billing_events from anon, authenticated;
grant select on public.billing_events to authenticated;
drop policy if exists billing_events_admin_select on public.billing_events;
create policy billing_events_admin_select on public.billing_events
for select to authenticated using ((select private.is_admin()));

alter table public.access_control drop constraint if exists access_control_subscription_status_check;
alter table public.access_control add constraint access_control_subscription_status_check
check (subscription_status in ('inactive','trialing','active','past_due','canceled','unpaid','paused'));

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(id,email,full_name)
  values(new.id,new.email,coalesce(new.raw_user_meta_data->>'full_name','Compte'));
  insert into public.access_control(user_id,role,plan,status,subscription_status)
  values(new.id,case when lower(coalesce(new.email,''))='denoual.mathispro@gmail.com' then 'admin' else 'user' end,'free','active','inactive');
  return new;
end $$;
revoke all on function public.handle_new_user() from public, anon, authenticated;
grant execute on function public.handle_new_user() to supabase_auth_admin;
