-- PseudocodeTutor baseline schema for a new Supabase project.
-- Run this once in Supabase Dashboard -> SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  exam_board text not null default 'cie-igcse',
  language text not null default 'python',
  theme text not null default 'dark',
  text_size text not null default 'medium',
  updated_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null default 'Untitled',
  problem text not null default '',
  problem_description text not null default '',
  problem_inputs text not null default '',
  problem_outputs text not null default '',
  problem_constraints text not null default '',
  pseudocode text not null default '',
  board text not null default 'cie-igcse',
  language text not null default 'python',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.community_problems (
  id uuid primary key default gen_random_uuid(),
  author_id uuid references public.profiles(id) on delete set null,
  created_by text,
  title text not null,
  description text not null default '',
  inputs text not null default '',
  outputs text not null default '',
  constraints text not null default '',
  board text not null,
  language text not null default 'python',
  problem_type text not null default 'forward',
  status text not null default 'approved',
  moderation_status text not null default 'approved',
  is_public boolean not null default true,
  attempt_count integer not null default 0,
  upvote_count integer not null default 0,
  difficulty text not null default 'unrated',
  created_at timestamptz not null default now()
);

create table if not exists public.community_solutions (
  id uuid primary key default gen_random_uuid(),
  problem_id uuid not null references public.community_problems(id) on delete cascade,
  pseudocode text not null,
  author_id text,
  is_ai_generated boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.community_ai_solutions (
  problem_id uuid primary key references public.community_problems(id) on delete cascade,
  solution text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.moderation_queue (
  id uuid primary key default gen_random_uuid(),
  problem_id uuid references public.community_problems(id) on delete cascade,
  content_type text,
  content_id uuid,
  reporter_id text,
  created_by text,
  user_id text,
  reason text,
  status text not null default 'pending',
  created_at timestamptz not null default now()
);

create index if not exists projects_user_id_idx on public.projects(user_id);
create index if not exists community_problems_board_idx on public.community_problems(board);
create index if not exists community_solutions_problem_id_idx on public.community_solutions(problem_id);
create index if not exists moderation_queue_problem_id_idx on public.moderation_queue(problem_id);
create index if not exists moderation_queue_content_idx on public.moderation_queue(content_type, content_id);

alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.community_problems enable row level security;
alter table public.community_solutions enable row level security;
alter table public.community_ai_solutions enable row level security;
alter table public.moderation_queue enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles for select using (auth.uid() = id);
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "projects_select_own" on public.projects;
create policy "projects_select_own" on public.projects for select using (auth.uid() = user_id);
drop policy if exists "projects_insert_own" on public.projects;
create policy "projects_insert_own" on public.projects for insert with check (auth.uid() = user_id);
drop policy if exists "projects_update_own" on public.projects;
create policy "projects_update_own" on public.projects for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "projects_delete_own" on public.projects;
create policy "projects_delete_own" on public.projects for delete using (auth.uid() = user_id);

drop policy if exists "community_problems_public_read" on public.community_problems;
create policy "community_problems_public_read" on public.community_problems
  for select using (coalesce(moderation_status, status, 'approved') <> 'rejected' and is_public);

drop policy if exists "community_solutions_public_read" on public.community_solutions;
create policy "community_solutions_public_read" on public.community_solutions for select using (true);

-- The current admin UI writes directly with the signed-in Supabase client.
-- Replace the placeholder email below before running this migration.
-- Keep it aligned with VITE_ADMIN_EMAIL in frontend/.env.local.
drop policy if exists "admin_manage_community_problems" on public.community_problems;
create policy "admin_manage_community_problems" on public.community_problems
  for all using (lower(auth.jwt() ->> 'email') = 'replace-with-admin-email@example.com')
  with check (lower(auth.jwt() ->> 'email') = 'replace-with-admin-email@example.com');

drop policy if exists "admin_read_moderation_queue" on public.moderation_queue;
create policy "admin_read_moderation_queue" on public.moderation_queue
  for select using (lower(auth.jwt() ->> 'email') = 'replace-with-admin-email@example.com');
drop policy if exists "admin_update_moderation_queue" on public.moderation_queue;
create policy "admin_update_moderation_queue" on public.moderation_queue
  for update using (lower(auth.jwt() ->> 'email') = 'replace-with-admin-email@example.com')
  with check (lower(auth.jwt() ->> 'email') = 'replace-with-admin-email@example.com');

create or replace function public.delete_current_user()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from auth.users where id = auth.uid();
end;
$$;

revoke all on function public.delete_current_user() from public;
grant execute on function public.delete_current_user() to authenticated;
