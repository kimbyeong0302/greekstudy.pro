-- 관리자(앱 소유자) 권한 추가
-- 이미 001 스키마를 적용하신 뒤에 이 파일을 이어서 실행하세요.

-- 관리자로 등록할 학번 목록 (여러 명 추가 가능)
create table if not exists greek_quiz.admins (
  student_number text primary key
);

insert into greek_quiz.admins (student_number) values ('2026420019')
on conflict do nothing;

-- students 테이블에 role 컬럼 추가 (기본은 'student', admins 테이블에 등록된 학번이면 'admin')
alter table greek_quiz.students
  add column if not exists role text not null default 'student'
  check (role in ('student', 'admin'));

-- 이미 가입되어 있는 계정 중 admins 테이블에 해당하는 학번이 있다면 지금 바로 승격
update greek_quiz.students s
set role = 'admin'
where exists (select 1 from greek_quiz.admins a where a.student_number = s.student_number);

-- 회원가입 트리거를 다시 정의: 학생 가입 시 admins 테이블에 있는 학번이면 role='admin'으로 생성
create or replace function greek_quiz.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (new.raw_user_meta_data->>'role') = 'professor' then
    insert into greek_quiz.professors (id, email, name)
    values (new.id, new.email, coalesce(new.raw_user_meta_data->>'name', new.email));
  elsif (new.raw_user_meta_data->>'role') = 'student' then
    insert into greek_quiz.students (id, student_number, name, role)
    values (
      new.id,
      new.raw_user_meta_data->>'student_number',
      coalesce(new.raw_user_meta_data->>'name', ''),
      case
        when exists (
          select 1 from greek_quiz.admins a
          where a.student_number = new.raw_user_meta_data->>'student_number'
        ) then 'admin'
        else 'student'
      end
    );
  end if;
  return new;
end;
$$;

-- 관리자인지 확인하는 헬퍼 함수 (RLS 정책에서 재사용)
create or replace function greek_quiz.is_admin(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from greek_quiz.students s where s.id = uid and s.role = 'admin'
  );
$$;

-- 관리자는 전체 데이터를 읦기 전용으로 조회 가능 (RLS 추가 정책 — 기존 정책과 함께 OR로 적용됨)
create policy admin_read_professors on greek_quiz.professors
  for select using (greek_quiz.is_admin(auth.uid()));

create policy admin_read_students on greek_quiz.students
  for select using (greek_quiz.is_admin(auth.uid()));

create policy admin_read_groups on greek_quiz.groups
  for select using (greek_quiz.is_admin(auth.uid()));

create policy admin_read_group_members on greek_quiz.group_members
  for select using (greek_quiz.is_admin(auth.uid()));

create policy admin_read_exams on greek_quiz.exams
  for select using (greek_quiz.is_admin(auth.uid()));

create policy admin_read_attempts on greek_quiz.attempts
  for select using (greek_quiz.is_admin(auth.uid()));
