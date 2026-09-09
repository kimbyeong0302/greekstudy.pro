-- 관리자 역할 지원: is_admin() 헬퍼 함수 + 각 테이블 RLS 정책 추가
-- user_metadata->>'role' = 'admin' 인 계정에 전체 조회/관리 권한 부여

create or replace function greek_quiz.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin';
$$;

grant execute on function greek_quiz.is_admin() to authenticated;

-- professors: 관리자 전체 조회/수정
drop policy if exists professors_all_admin on greek_quiz.professors;
create policy professors_all_admin on greek_quiz.professors
  for all using (greek_quiz.is_admin()) with check (greek_quiz.is_admin());

-- students: 관리자 전체 조회/수정
drop policy if exists students_all_admin on greek_quiz.students;
create policy students_all_admin on greek_quiz.students
  for all using (greek_quiz.is_admin()) with check (greek_quiz.is_admin());

-- groups: 관리자 전체 조회/수정
drop policy if exists groups_all_admin on greek_quiz.groups;
create policy groups_all_admin on greek_quiz.groups
  for all using (greek_quiz.is_admin()) with check (greek_quiz.is_admin());

-- group_members: 관리자 전체 조회
drop policy if exists group_members_all_admin on greek_quiz.group_members;
create policy group_members_all_admin on greek_quiz.group_members
  for all using (greek_quiz.is_admin()) with check (greek_quiz.is_admin());

-- notices: 관리자 전체 관리 (전체 공지 포함)
drop policy if exists notices_all_admin on greek_quiz.notices;
create policy notices_all_admin on greek_quiz.notices
  for all using (greek_quiz.is_admin()) with check (greek_quiz.is_admin());

-- words: 관리자 전체 관리
drop policy if exists words_all_admin on greek_quiz.words;
create policy words_all_admin on greek_quiz.words
  for all using (greek_quiz.is_admin()) with check (greek_quiz.is_admin());

-- exams: 관리자 전체 조회
drop policy if exists exams_all_admin on greek_quiz.exams;
create policy exams_all_admin on greek_quiz.exams
  for all using (greek_quiz.is_admin()) with check (greek_quiz.is_admin());

-- attempts: 관리자 전체 조회
drop policy if exists attempts_all_admin on greek_quiz.attempts;
create policy attempts_all_admin on greek_quiz.attempts
  for all using (greek_quiz.is_admin()) with check (greek_quiz.is_admin());
