-- One signed-in user's current up/down vote per community problem.
create table if not exists public.community_problem_votes (
  problem_id uuid not null references public.community_problems(id) on delete cascade,
  user_id text not null,
  vote text not null check (vote in ('up', 'down')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (problem_id, user_id)
);

create index if not exists community_problem_votes_problem_idx
  on public.community_problem_votes(problem_id);
