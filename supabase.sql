-- ============================================================
-- 플랜두씨 다이어리 2 — 계획/하위할일/자동실행기록 구조
-- Diary 1과 충돌하지 않도록 모든 공개 테이블/함수에 d2_ 접두사 사용
-- 새 Diary 2 Supabase 프로젝트에서 최초 1회 실행
-- ============================================================
create extension if not exists pgcrypto;

create table public.d2_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.d2_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  start_date date not null,
  end_date date not null,
  priority text not null default 'medium' check (priority in ('high','medium','low')),
  success_criteria text not null default '',
  expected_minutes integer not null default 0 check (expected_minutes >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint d2_plans_date_order check (end_date >= start_date)
);

create table public.d2_plan_versions (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.d2_plans(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  version_no integer not null,
  title text not null,
  start_date date not null,
  end_date date not null,
  priority text not null check (priority in ('high','medium','low')),
  success_criteria text not null default '',
  expected_minutes integer not null default 0 check (expected_minutes >= 0),
  created_at timestamptz not null default now(),
  unique(plan_id, version_no)
);

-- 할 일은 독립 화면에서 생성하지 않고 항상 d2_plans의 하위 항목으로 생성한다.
create table public.d2_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_id uuid not null references public.d2_plans(id) on delete cascade,
  title text not null,
  due_date date,
  priority text not null default 'medium' check (priority in ('high','medium','low')),
  tags text[] not null default '{}',
  expected_minutes integer not null default 0 check (expected_minutes >= 0),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 완료 버튼을 누른 사실을 한 번만 기록한다.
create table public.d2_task_completions (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null unique references public.d2_tasks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  completed_at timestamptz not null default now(),
  completed_date date generated always as ((completed_at at time zone 'Asia/Seoul')::date) stored
);

-- 계획 자체를 완료로 옮긴 사실을 한 번만 기록한다.
create table public.d2_plan_completions (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null unique references public.d2_plans(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  completed_at timestamptz not null default now()
);

-- 사용자가 직접 입력하지 않는다. 완료 RPC가 자동 생성한다.
create table public.d2_execution_logs (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null unique references public.d2_tasks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  completed_at timestamptz not null default now(),
  completed_date date generated always as ((completed_at at time zone 'Asia/Seoul')::date) stored,
  created_at timestamptz not null default now()
);

create or replace function public.d2_set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end;
$$;

create trigger d2_profiles_set_updated_at before update on public.d2_profiles
for each row execute function public.d2_set_updated_at();
create trigger d2_plans_set_updated_at before update on public.d2_plans
for each row execute function public.d2_set_updated_at();
create trigger d2_tasks_set_updated_at before update on public.d2_tasks
for each row execute function public.d2_set_updated_at();

create or replace function public.d2_block_completed_task_update()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if exists(select 1 from public.d2_task_completions c where c.task_id=old.id) then
    raise exception 'completed task is read-only';
  end if;
  return new;
end;
$$;
create trigger d2_tasks_block_completed_update before update on public.d2_tasks
for each row execute function public.d2_block_completed_task_update();

create or replace function public.d2_block_completed_plan_update()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if exists(select 1 from public.d2_plan_completions c where c.plan_id=old.id) then
    raise exception 'completed plan is read-only';
  end if;
  return new;
end;
$$;
create trigger d2_plans_block_completed_update before update on public.d2_plans
for each row execute function public.d2_block_completed_plan_update();

create or replace function public.d2_block_task_if_plan_completed()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if exists(select 1 from public.d2_plan_completions c where c.plan_id=old.plan_id) then
    raise exception 'task belongs to a completed plan';
  end if;
  return new;
end;
$$;
create trigger d2_tasks_block_completed_plan_update before update on public.d2_tasks
for each row execute function public.d2_block_task_if_plan_completed();

create or replace function public.d2_handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin insert into public.d2_profiles(id) values(new.id); return new; end;
$$;
create trigger d2_on_auth_user_created after insert on auth.users
for each row execute function public.d2_handle_new_user();

create or replace function public.d2_capture_plan_version()
returns trigger language plpgsql set search_path = '' as $$
declare next_version integer;
begin
  select coalesce(max(version_no),0)+1 into next_version from public.d2_plan_versions where plan_id=old.id;
  insert into public.d2_plan_versions(plan_id,user_id,version_no,title,start_date,end_date,priority,success_criteria,expected_minutes)
  values(old.id,old.user_id,next_version,old.title,old.start_date,old.end_date,old.priority,old.success_criteria,old.expected_minutes);
  return new;
end;
$$;
create trigger d2_plans_capture_version before update on public.d2_plans
for each row when (
  old.title is distinct from new.title or old.start_date is distinct from new.start_date or
  old.end_date is distinct from new.end_date or old.priority is distinct from new.priority or
  old.success_criteria is distinct from new.success_criteria or old.expected_minutes is distinct from new.expected_minutes
) execute function public.d2_capture_plan_version();

-- 계획 완료 버튼: 계획 자체를 완료 탭으로 이동시키고 이후 수정할 수 없게 한다.
create or replace function public.d2_complete_plan_once(p_plan_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'authentication required'; end if;
  if not exists(select 1 from public.d2_plans where id=p_plan_id and user_id=uid) then
    raise exception 'plan not found';
  end if;
  insert into public.d2_plan_completions(plan_id,user_id,completed_at)
  values(p_plan_id,uid,now())
  on conflict(plan_id) do nothing;
  return found;
end;
$$;

-- 완료 버튼: 완료 기록 + 실행 기록을 한 트랜잭션으로 만든다.
create or replace function public.d2_complete_task_once(p_task_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); completed_at_value timestamptz := now();
begin
  if uid is null then raise exception 'authentication required'; end if;
  if not exists(select 1 from public.d2_tasks where id=p_task_id and user_id=uid and deleted_at is null) then
    raise exception 'task not found';
  end if;
  if exists(select 1 from public.d2_tasks t join public.d2_plan_completions pc on pc.plan_id=t.plan_id where t.id=p_task_id and pc.user_id=uid) then
    raise exception 'task belongs to a completed plan';
  end if;
  insert into public.d2_task_completions(task_id,user_id,completed_at)
  values(p_task_id,uid,completed_at_value)
  on conflict(task_id) do nothing;
  if not found then return false; end if;
  insert into public.d2_execution_logs(task_id,user_id,completed_at)
  select p_task_id,uid,completed_at_value from public.d2_tasks where id=p_task_id;
  return true;
end;
$$;

create or replace function public.d2_undo_task_completion(p_task_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'authentication required'; end if;
  delete from public.d2_execution_logs where task_id=p_task_id and user_id=uid;
  delete from public.d2_task_completions where task_id=p_task_id and user_id=uid;
  return true;
end;
$$;

-- 현재 로그인 계정과 그 계정의 자료를 삭제한다.
create or replace function public.d2_delete_my_account()
returns boolean language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'authentication required'; end if;
  delete from auth.users where id=uid;
  return true;
end;
$$;

create index d2_plans_user_id_idx on public.d2_plans(user_id);
create index d2_tasks_user_id_idx on public.d2_tasks(user_id);
create index d2_tasks_plan_id_idx on public.d2_tasks(plan_id);
create index d2_task_completions_user_id_idx on public.d2_task_completions(user_id);
create index d2_plan_completions_user_id_idx on public.d2_plan_completions(user_id);
create index d2_plan_completions_plan_id_idx on public.d2_plan_completions(plan_id);
create index d2_execution_logs_user_id_date_idx on public.d2_execution_logs(user_id,completed_date desc);
create index d2_plan_versions_plan_id_idx on public.d2_plan_versions(plan_id);

alter table public.d2_profiles enable row level security;
alter table public.d2_plans enable row level security;
alter table public.d2_plan_versions enable row level security;
alter table public.d2_tasks enable row level security;
alter table public.d2_task_completions enable row level security;
alter table public.d2_plan_completions enable row level security;
alter table public.d2_execution_logs enable row level security;

revoke all on table public.d2_profiles,public.d2_plans,public.d2_plan_versions,public.d2_tasks,public.d2_task_completions,public.d2_plan_completions,public.d2_execution_logs from anon,authenticated;
grant select,insert,update,delete on public.d2_profiles,public.d2_plans,public.d2_plan_versions,public.d2_tasks,public.d2_task_completions,public.d2_execution_logs to authenticated;
grant select on public.d2_plan_completions to authenticated;


create policy d2_profiles_select_own on public.d2_profiles for select to authenticated using((select auth.uid())=id);
create policy d2_profiles_insert_own on public.d2_profiles for insert to authenticated with check((select auth.uid())=id);
create policy d2_profiles_update_own on public.d2_profiles for update to authenticated using((select auth.uid())=id) with check((select auth.uid())=id);
create policy d2_profiles_delete_own on public.d2_profiles for delete to authenticated using((select auth.uid())=id);

create policy d2_plans_select_own on public.d2_plans for select to authenticated using((select auth.uid())=user_id);
create policy d2_plans_insert_own on public.d2_plans for insert to authenticated with check((select auth.uid())=user_id);
create policy d2_plans_update_own on public.d2_plans for update to authenticated using((select auth.uid())=user_id) with check((select auth.uid())=user_id);
create policy d2_plans_delete_own on public.d2_plans for delete to authenticated using((select auth.uid())=user_id);

create policy d2_plan_versions_select_own on public.d2_plan_versions for select to authenticated using((select auth.uid())=user_id);
create policy d2_plan_versions_insert_own on public.d2_plan_versions for insert to authenticated with check((select auth.uid())=user_id);
create policy d2_plan_versions_update_own on public.d2_plan_versions for update to authenticated using((select auth.uid())=user_id) with check((select auth.uid())=user_id);
create policy d2_plan_versions_delete_own on public.d2_plan_versions for delete to authenticated using((select auth.uid())=user_id);

create policy d2_tasks_select_own on public.d2_tasks for select to authenticated using((select auth.uid())=user_id);
create policy d2_tasks_insert_own on public.d2_tasks for insert to authenticated with check((select auth.uid())=user_id);
create policy d2_tasks_update_own on public.d2_tasks for update to authenticated using((select auth.uid())=user_id) with check((select auth.uid())=user_id);
create policy d2_tasks_delete_own on public.d2_tasks for delete to authenticated using((select auth.uid())=user_id);

create policy d2_task_completions_select_own on public.d2_task_completions for select to authenticated using((select auth.uid())=user_id);

create policy d2_plan_completions_select_own on public.d2_plan_completions for select to authenticated using((select auth.uid())=user_id);

create policy d2_execution_logs_select_own on public.d2_execution_logs for select to authenticated using((select auth.uid())=user_id);



revoke execute on function public.d2_complete_plan_once(uuid) from public,anon;
grant execute on function public.d2_complete_plan_once(uuid) to authenticated;
revoke execute on function public.d2_complete_task_once(uuid) from public,anon;
grant execute on function public.d2_complete_task_once(uuid) to authenticated;
revoke execute on function public.d2_undo_task_completion(uuid) from public,anon;
grant execute on function public.d2_undo_task_completion(uuid) to authenticated;
revoke execute on function public.d2_delete_my_account() from public,anon;
grant execute on function public.d2_delete_my_account() to authenticated;
