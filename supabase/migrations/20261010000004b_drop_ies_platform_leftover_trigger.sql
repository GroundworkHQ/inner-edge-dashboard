-- Applied 2026-10-10 (as drop_ies_platform_leftover_trigger). Not part of the
-- dashboard: removes a leftover from the IES Platform torn down 2026-07-30,
-- which wrote to public.ies_users (already dropped) on every new auth user.
drop trigger if exists on_ies_auth_user_created on auth.users;
drop function if exists public.ies_handle_new_user();
