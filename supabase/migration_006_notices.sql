-- 공지사항 기능 추가
-- scope='system': 관리자가 등록, 모든 로그인 사용자가 볼 수 있음 (예: 시스템 업그레이드 안내)
-- scope='group' : 담당 교수가 등록, 그 그룹에 속한 학생 + 담당 교수만 볼 수 있음
--
-- 참고: 그룹 삭제 기능 자체는 추가 마이그레이션이 필요 없습니다 — groups 테이블을
-- 참조하는 group_members/exams/attempts가 이미 전부 ON DELETE CASCADE로 걸려있어서
-- (greek_quiz_schema.sql 기준) 그룹을 지우면 자동으로 함께 정리됩니다.
-- notices도 동일하게 group_id에 CASCADE를 걸어둡니다.

create table if not exists greek_quiz.notices (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('system', 'group')),
  group_id uuid references greek_quiz.groups(id) on delete cascade,
  author_id uuid not null default auth.uid(),
  content text not null,
  created_at timestamptz not null default now(),
  constraint notices_scope_group_check check (
    (scope = 'group' and group_id is not null) or (scope = 'system' and group_id is null)
  )
);

alter table greek_quiz.notices enable row level security;

-- 이 마이그레이션을 다시 실행해도 안전하도록, 정책은 항상 지우고 다시 만듭니다.
drop policy if exists notices_select_system on greek_quiz.notices;
drop policy if exists notices_select_group_member on greek_quiz.notices;
drop policy if exists notices_select_group_professor on greek_quiz.notices;
drop policy if exists admin_read_notices on greek_quiz.notices;
drop policy if exists notices_insert_professor on greek_quiz.notices;
drop policy if exists notices_insert_admin on greek_quiz.notices;
drop policy if exists notices_delete_own on greek_quiz.notices;

-- 조회: 시스템 공지는 로그인한 누구나, 그룹 공지는 그 그룹 소속 학생/담당 교수만
create policy notices_select_system on greek_quiz.notices
  for select using (scope = 'system' and auth.uid() is not null);

create policy notices_select_group_member on greek_quiz.notices
  for select using (scope = 'group' and greek_quiz.is_member_of_group(group_id, auth.uid()));

create policy notices_select_group_professor on greek_quiz.notices
  for select using (scope = 'group' and greek_quiz.owns_group(group_id, auth.uid()));

create policy admin_read_notices on greek_quiz.notices
  for select using (greek_quiz.is_admin(auth.uid()));

-- 등록: 교수는 자기 그룹에만, 관리자는 시스템 공지만
create policy notices_insert_professor on greek_quiz.notices
  for insert with check (scope = 'group' and greek_quiz.owns_group(group_id, auth.uid()));

create policy notices_insert_admin on greek_quiz.notices
  for insert with check (scope = 'system' and greek_quiz.is_admin(auth.uid()));

-- 삭제: 작성자 본인만
create policy notices_delete_own on greek_quiz.notices
  for delete using (author_id = auth.uid());

-- greek_quiz 스키마 전체에 이미 걸려있는 default privileges로 자동 커버되지만,
-- 혹시를 위해 명시적으로도 부여합니다.
grant select, insert, delete on greek_quiz.notices to anon, authenticated;
