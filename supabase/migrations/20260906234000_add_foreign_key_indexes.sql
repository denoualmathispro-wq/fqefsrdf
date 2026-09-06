create index if not exists favorites_listing_idx on public.favorites(listing_id);
create index if not exists imports_user_idx on public.imports(user_id);
create index if not exists notifications_listing_idx on public.notifications(listing_id);
create index if not exists audit_logs_actor_idx on public.audit_logs(actor_id);
create index if not exists audit_logs_target_user_idx on public.audit_logs(target_user_id);
