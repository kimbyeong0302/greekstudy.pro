-- 헬라어 퀴즈 앱 — 교수/학생 시스템 스키마
-- 별도 스키마(greek_quiz)에 생성하여 토블 앱의 public 스키마(profiles/books/notes 등)와 분리합니다.

create schema if not exists greek_quiz;

-- =========================================================
-- 1. 프로필 테이블 (auth.users 확장)
-- =========================================================

create table if not exists greek_quiz.professors (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists greek_quiz.students (
  id uuid primary key references auth.users(id) on delete cascade,
  student_number text not null unique,
  name text not null,
  created_at timestamptz not null default now()
);

-- 회원가입 시 auth.users에 저장된 raw_user_meta_data를 읦어
-- role에 따라 professors / students 프로필을 자동 생성하는 트리거.
-- 프론트엔드는 signUp 호출 시 options.data 에 { role: 'professor', name }
-- 또는 { role: 'student', name, student_number } 를 넘겨야 합니다.
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
    insert into greek_quiz.students (id, student_number, name)
    values (
      new.id,
      new.raw_user_meta_data->>'student_number',
      coalesce(new.raw_user_meta_data->>'name', '')
    );
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_greek_quiz on auth.users;
create trigger on_auth_user_created_greek_quiz
  after insert on auth.users
  for each row execute function greek_quiz.handle_new_user();

-- =========================================================
-- 2. 수강 그룹 (과목)
-- =========================================================

create table if not exists greek_quiz.groups (
  id uuid primary key default gen_random_uuid(),
  professor_id uuid not null references greek_quiz.professors(id) on delete cascade,
  name text not null,
  join_code text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists greek_quiz.group_members (
  group_id uuid not null references greek_quiz.groups(id) on delete cascade,
  student_id uuid not null references greek_quiz.students(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (group_id, student_id)
);

-- 학생이 가입 코드를 입력해 그룹에 들어가는 함수.
-- 코드를 직접 select 할 수 있는 권한을 주지 않기 위해 security definer로 처리.
create or replace function greek_quiz.join_group_by_code(p_code text)
returns table (group_id uuid, group_name text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id uuid;
  v_group_name text;
begin
  select id, name into v_group_id, v_group_name
  from greek_quiz.groups g
  where g.join_code = p_code;

  if v_group_id is null then
    raise exception '유효하지 않은 코드입니다.';
  end if;

  insert into greek_quiz.group_members (group_id, student_id)
  values (v_group_id, auth.uid())
  on conflict (group_id, student_id) do nothing;

  return query select v_group_id, v_group_name;
end;
$$;

-- =========================================================
-- 3. 단어 (전역 공유 세트 — 필요 시 그룹별 확장 가능)
-- =========================================================

create table if not exists greek_quiz.words (
  id bigint generated always as identity primary key,
  gr text not null,
  kr text,
  en text not null,
  ko text not null,
  week int not null
);

-- =========================================================
-- 4. 시험 & 응시 기록
-- =========================================================

create table if not exists greek_quiz.exams (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references greek_quiz.groups(id) on delete cascade,
  weeks int[] not null,
  level int not null check (level in (1, 2, 3)),
  mode text not null default 'test' check (mode in ('practice', 'test')),
  time_limit_sec int not null default 3,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists greek_quiz.attempts (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references greek_quiz.exams(id) on delete cascade,
  student_id uuid not null references greek_quiz.students(id) on delete cascade,
  score int not null,
  total int not null,
  wrong_answers jsonb not null default '[]'::jsonb,
  submitted_at timestamptz not null default now(),
  unique (exam_id, student_id)
);

-- =========================================================
-- 5. RLS 활성화 및 정책
-- =========================================================

alter table greek_quiz.professors enable row level security;
alter table greek_quiz.students enable row level security;
alter table greek_quiz.groups enable row level security;
alter table greek_quiz.group_members enable row level security;
alter table greek_quiz.words enable row level security;
alter table greek_quiz.exams enable row level security;
alter table greek_quiz.attempts enable row level security;

-- professors: 본인 행만
create policy professors_select_own on greek_quiz.professors
  for select using (id = auth.uid());
create policy professors_update_own on greek_quiz.professors
  for update using (id = auth.uid());

-- students: 본인 행만 (교수는 자기 그룹 멤버 명단 조회 시 group_members 조인으로 접근)
create policy students_select_own on greek_quiz.students
  for select using (id = auth.uid());
create policy students_select_by_professor on greek_quiz.students
  for select using (
    exists (
      select 1 from greek_quiz.group_members gm
      join greek_quiz.groups g on g.id = gm.group_id
      where gm.student_id = greek_quiz.students.id
        and g.professor_id = auth.uid()
    )
  );

-- groups: 교수는 자기 그룹 CRUD, 학생은 자기가 속한 그룹만 조회
create policy groups_all_own_professor on greek_quiz.groups
  for all using (professor_id = auth.uid());
create policy groups_select_member on greek_quiz.groups
  for select using (
    exists (
      select 1 from greek_quiz.group_members gm
      where gm.group_id = greek_quiz.groups.id
        and gm.student_id = auth.uid()
    )
  );

-- group_members: 학생은 자기 멤버십만 조회 (가입은 join_group_by_code 함수로만),
-- 교수는 자기 그룹의 멤버 조회
create policy group_members_select_own on greek_quiz.group_members
  for select using (student_id = auth.uid());
create policy group_members_select_by_professor on greek_quiz.group_members
  for select using (
    exists (
      select 1 from greek_quiz.groups g
      where g.id = greek_quiz.group_members.group_id
        and g.professor_id = auth.uid()
    )
  );

-- words: 로그인한 사용자 누구나 읦기 가능, 쓰기는 교수만
create policy words_select_all on greek_quiz.words
  for select using (auth.uid() is not null);
create policy words_write_professor on greek_quiz.words
  for all using (
    exists (select 1 from greek_quiz.professors p where p.id = auth.uid())
  );

-- exams: 교수는 자기 그룹의 시험 CRUD, 학생은 자기 그룹의 활성 시험만 조회
create policy exams_all_own_professor on greek_quiz.exams
  for all using (
    exists (
      select 1 from greek_quiz.groups g
      where g.id = greek_quiz.exams.group_id
        and g.professor_id = auth.uid()
    )
  );
create policy exams_select_member on greek_quiz.exams
  for select using (
    active = true
    and exists (
      select 1 from greek_quiz.group_members gm
      where gm.group_id = greek_quiz.exams.group_id
        and gm.student_id = auth.uid()
    )
  );

-- attempts: 학생은 자기 응시만 생성/조회, 교수는 자기 그룹 관련 응시 조회
create policy attempts_insert_own on greek_quiz.attempts
  for insert with check (student_id = auth.uid());
create policy attempts_select_own on greek_quiz.attempts
  for select using (student_id = auth.uid());
create policy attempts_select_by_professor on greek_quiz.attempts
  for select using (
    exists (
      select 1 from greek_quiz.exams e
      join greek_quiz.groups g on g.id = e.group_id
      where e.id = greek_quiz.attempts.exam_id
        and g.professor_id = auth.uid()
    )
  );
