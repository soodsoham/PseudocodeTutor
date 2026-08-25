-- PseudoWizard baseline schema for Neon Postgres + Neon Auth + Neon Data API.
-- Apply with a database-owner connection. Browser access is still constrained by RLS.

begin;

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id text primary key,
  display_name text,
  exam_board text not null default 'cie-igcse',
  language text not null default 'python',
  theme text not null default 'dark',
  text_size text not null default 'medium',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Keep an app profile for every Neon Auth identity without copying email addresses.
create or replace function public.handle_neon_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, nullif(new.name, ''))
  on conflict (id) do update
    set display_name = coalesce(public.profiles.display_name, excluded.display_name);
  return new;
end;
$$;

drop trigger if exists on_neon_auth_user_created on neon_auth."user";
create trigger on_neon_auth_user_created
  after insert on neon_auth."user"
  for each row execute function public.handle_neon_auth_user();

insert into public.profiles (id, display_name)
select id, nullif(name, '') from neon_auth."user"
on conflict (id) do update
  set display_name = coalesce(public.profiles.display_name, excluded.display_name);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references public.profiles(id) on delete cascade,
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
  author_id text references public.profiles(id) on delete set null,
  created_by text,
  title text not null,
  description text not null default '',
  inputs text not null default '',
  outputs text not null default '',
  constraints text not null default '',
  board text not null,
  language text not null default 'python',
  problem_type text not null default 'forward',
  status text not null default 'approved'
    check (status in ('pending', 'approved', 'rejected', 'archived')),
  moderation_status text not null default 'approved'
    check (moderation_status in ('pending', 'approved', 'rejected', 'archived')),
  is_public boolean not null default true,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  upvote_count integer not null default 0 check (upvote_count >= 0),
  difficulty text not null default 'unrated',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.community_solutions (
  id uuid primary key default gen_random_uuid(),
  problem_id uuid not null references public.community_problems(id) on delete cascade,
  pseudocode text not null,
  author_id text,
  is_ai_generated boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.community_ai_solutions (
  problem_id uuid primary key references public.community_problems(id) on delete cascade,
  solution text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.community_attachments (
  id uuid primary key default gen_random_uuid(),
  problem_id uuid not null references public.community_problems(id) on delete cascade,
  owner_id text not null references public.profiles(id) on delete cascade,
  object_key text not null unique,
  file_name text not null,
  file_type text not null default 'application/pdf',
  size_bytes integer not null check (size_bytes between 1 and 10485760),
  created_at timestamptz not null default now()
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
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists projects_user_id_idx on public.projects(user_id);
create index if not exists community_problems_board_idx on public.community_problems(board);
create index if not exists community_problems_created_by_idx on public.community_problems(created_by);
create index if not exists community_solutions_problem_id_idx on public.community_solutions(problem_id);
create index if not exists community_attachments_problem_id_idx on public.community_attachments(problem_id);
create index if not exists moderation_queue_problem_id_idx on public.moderation_queue(problem_id);
create index if not exists moderation_queue_content_idx on public.moderation_queue(content_type, content_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at before update on public.profiles
for each row execute function public.set_updated_at();
drop trigger if exists projects_set_updated_at on public.projects;
create trigger projects_set_updated_at before update on public.projects
for each row execute function public.set_updated_at();
drop trigger if exists community_problems_set_updated_at on public.community_problems;
create trigger community_problems_set_updated_at before update on public.community_problems
for each row execute function public.set_updated_at();
drop trigger if exists community_solutions_set_updated_at on public.community_solutions;
create trigger community_solutions_set_updated_at before update on public.community_solutions
for each row execute function public.set_updated_at();
drop trigger if exists community_ai_solutions_set_updated_at on public.community_ai_solutions;
create trigger community_ai_solutions_set_updated_at before update on public.community_ai_solutions
for each row execute function public.set_updated_at();
drop trigger if exists moderation_queue_set_updated_at on public.moderation_queue;
create trigger moderation_queue_set_updated_at before update on public.moderation_queue
for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.community_problems enable row level security;
alter table public.community_solutions enable row level security;
alter table public.community_ai_solutions enable row level security;
alter table public.community_attachments enable row level security;
alter table public.moderation_queue enable row level security;

drop policy if exists profiles_own_rows on public.profiles;
create policy profiles_own_rows on public.profiles
  for all to authenticated
  using (id = auth.user_id())
  with check (id = auth.user_id());

drop policy if exists projects_own_rows on public.projects;
create policy projects_own_rows on public.projects
  for all to authenticated
  using (user_id = auth.user_id())
  with check (user_id = auth.user_id());

drop policy if exists community_problems_public_read on public.community_problems;
create policy community_problems_public_read on public.community_problems
  for select to anonymous, authenticated
  using (is_public and status = 'approved' and moderation_status = 'approved');

drop policy if exists community_problems_create_own on public.community_problems;
create policy community_problems_create_own on public.community_problems
  for insert to authenticated
  with check (created_by = auth.user_id() or author_id = auth.user_id());

drop policy if exists community_problems_manage_own on public.community_problems;
create policy community_problems_manage_own on public.community_problems
  for update to authenticated
  using (created_by = auth.user_id() or author_id = auth.user_id())
  with check (created_by = auth.user_id() or author_id = auth.user_id());

drop policy if exists community_problems_delete_own on public.community_problems;
create policy community_problems_delete_own on public.community_problems
  for delete to authenticated
  using (created_by = auth.user_id() or author_id = auth.user_id());

drop policy if exists community_solutions_public_read on public.community_solutions;
create policy community_solutions_public_read on public.community_solutions
  for select to anonymous, authenticated using (true);

drop policy if exists community_solutions_create_own on public.community_solutions;
create policy community_solutions_create_own on public.community_solutions
  for insert to authenticated
  with check (author_id = auth.user_id() and not is_ai_generated);

drop policy if exists community_solutions_manage_own on public.community_solutions;
create policy community_solutions_manage_own on public.community_solutions
  for update to authenticated
  using (author_id = auth.user_id() and not is_ai_generated)
  with check (author_id = auth.user_id() and not is_ai_generated);

drop policy if exists community_solutions_delete_own on public.community_solutions;
create policy community_solutions_delete_own on public.community_solutions
  for delete to authenticated
  using (author_id = auth.user_id() and not is_ai_generated);

drop policy if exists community_ai_solutions_public_read on public.community_ai_solutions;
create policy community_ai_solutions_public_read on public.community_ai_solutions
  for select to anonymous, authenticated using (true);

drop policy if exists community_attachments_public_read on public.community_attachments;
create policy community_attachments_public_read on public.community_attachments
  for select to anonymous, authenticated
  using (
    exists (
      select 1 from public.community_problems problem
      where problem.id = problem_id
        and problem.is_public
        and problem.status = 'approved'
        and problem.moderation_status = 'approved'
    )
  );

drop policy if exists community_attachments_manage_own on public.community_attachments;
create policy community_attachments_manage_own on public.community_attachments
  for all to authenticated
  using (owner_id = auth.user_id())
  with check (owner_id = auth.user_id());

drop policy if exists moderation_queue_create_own on public.moderation_queue;
create policy moderation_queue_create_own on public.moderation_queue
  for insert to authenticated
  with check (
    reporter_id = auth.user_id()
    or created_by = auth.user_id()
    or user_id = auth.user_id()
  );

drop policy if exists moderation_queue_read_own on public.moderation_queue;
create policy moderation_queue_read_own on public.moderation_queue
  for select to authenticated
  using (
    reporter_id = auth.user_id()
    or created_by = auth.user_id()
    or user_id = auth.user_id()
  );

grant usage on schema public to anonymous, authenticated;
grant select on public.community_problems, public.community_solutions, public.community_ai_solutions
  to anonymous;
grant select on public.community_attachments to anonymous;
grant select, insert, update, delete on
  public.profiles,
  public.projects,
  public.community_problems,
  public.community_solutions,
  public.community_attachments,
  public.moderation_queue
  to authenticated;
grant select on public.community_ai_solutions to authenticated;

commit;
