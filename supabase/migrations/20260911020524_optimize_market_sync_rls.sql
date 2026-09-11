drop policy "market sync sources are readable by owner" on public.market_sync_sources;
drop policy "market sync sources are insertable by owner" on public.market_sync_sources;
drop policy "market sync sources are editable by owner" on public.market_sync_sources;
drop policy "market sync sources are deletable by owner" on public.market_sync_sources;
drop policy "market sync runs are readable by owner" on public.market_sync_runs;

create policy "market sync sources are readable by owner" on public.market_sync_sources
for select to authenticated using ((select auth.uid()) = user_id);
create policy "market sync sources are insertable by owner" on public.market_sync_sources
for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "market sync sources are editable by owner" on public.market_sync_sources
for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "market sync sources are deletable by owner" on public.market_sync_sources
for delete to authenticated using ((select auth.uid()) = user_id);
create policy "market sync runs are readable by owner" on public.market_sync_runs
for select to authenticated using ((select auth.uid()) = user_id);
