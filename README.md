# greekquiz-pro — 헬라어 단어시험 교수/학생 시스템

`greekstudy`(개인용 헬라어 퀴즈)와는 별도의 새 앱입니다. 퀴즈 화면(단어 카드, 선택지, 카운트다운)은 기존 UI를 재사용했고, 교수-학생 계정/그룹/시험/결과 이메일 기능이 새로 추가되었습니다.

## 구성

- `index.html` — 로그인/회원가입 (교수: 이메일+비밀번호, 학생: 학번+이름+비밀번호)
- `professor.html` — 교수 대시보드: 그룹 생성/가입코드 발급, 시험 세팅, 결과 조회, 엑셀 이메일 전송
- `student.html` — 학생 홈: 가입 코드 입력, 응시 가능한 시험 목록
- `quiz.html` — 실제 시험 응시 화면 (1회만 응시 가능)
- `supabase-client.js` — Supabase 연결 및 공통 API 함수
- `supabase/greek_quiz_schema.sql`(별도 전달) — DB 테이블/RLS 마이그레이션
- `supabase/seed_words.sql` — 1주차 단어 시드 데이터
- `supabase/functions/send-report/index.ts` — 결과 엑셀을 만들어 Resend로 이메일 전송하는 Edge Function
- `supabase/functions/signup/index.ts` — 학생 전용 가입 Edge Function (실제 이메일이 없는 계정이라 관리자 권한으로 바로 인증된 상태로 생성)
- `admin.html` — 관리자(앱 소유자) 전용 대시보드: 전체 교수/그룹/학생/시험 현황을 읦기 전용으로 조회
- `supabase/migration_002_admin_role.sql` — 관리자 권한 추가 마이그레이션 (001 스키마 적용 후 이어서 실행)

## 배포 전 체크리스트

1. **DB 마이그레이션 적용**: `greek_quiz_schema.sql` → `migration_002_admin_role.sql` → `seed_words.sql` 순서로 Supabase 프로젝트(`tepsuxyfyrkylyhsngwo`)에 적용
2. **Edge Function 배포**: `supabase functions deploy send-report`, `supabase functions deploy signup`
3. **Resend 시크릿 등록**: `supabase secrets set RESEND_API_KEY=발급받은키`
   - 자체 도메인을 아직 Resend에 인증하지 않았다면, 발신 주소는 기본값(`onboarding@resend.dev`)으로 테스트 가능
   - 도메인 인증 후에는 `supabase secrets set REPORT_FROM_ADDRESS=noreply@내도메인.kr`
4. **GitHub Pages 배포**: 이 폴더를 새 저장소(`greekquiz-pro`)에 올리고 GitHub Pages 활성화

## 회원가입 방식이 교수/학생마다 다른 이유

- **교수**: 실제 이메일을 쓰므로 토블 앱과 동일하게 Supabase 기본 이메일 인증 절차(가입 → 인증 메일의 링크 클릭 → 로그인)를 그대로 따릅니다. 프로젝트에 이미 연결된 Resend SMTP를 그대로 재사용하므로 추가 설정이 필요 없습니다.
- **학생**: 학번 기반의 가짜 이메일(`s학번@students.greekquiz.local`)을 쓰기 때문에 인증 메일을 받아 클릭할 방법이 없습니다. 그래서 학생만 `signup` Edge Function을 통해 관리자 권한으로 이미 인증된 상태의 계정을 만들어 가입 즉시 로그인할 수 있게 합니다.

Supabase의 "이메일 인증 필수" 설정은 프로젝트 전체(토블 앱과 공유)에 적용되는 값이라 그대로 켜져 있어도 문제 없습니다 — 학생 계정은 그 설정과 무관하게 관리자 API로 직접 인증 처리되기 때문입니다.

## 관리자(앱 소유자) 계정

학번 `2026420019`로 학생 가입을 하면 자동으로 관리자 권한이 부여되고, 로그인 시 `admin.html`로 이동합니다. 관리자는 전체 교수/그룹/학생/시험 현황을 읦기 전용으로 볼 수 있습니다. 관리자를 더 추가하려면 Supabase SQL Editor에서:

```sql
insert into greek_quiz.admins (student_number) values ('추가할학번');
```

이미 가입되어 있던 학번이라면 위 SQL 실행 후 `update greek_quiz.students set role = 'admin' where student_number = '추가할학번';`도 함께 실행해주세요.

## 회원가입/로그인 결과 팝업

회원가입이 성공하면 "회원가입이 되었습니다" 팝업이 뜨고(교수는 이메일 인증 안내가 함께 표시됩니다), 이미 등록된 학번으로 다시 가입을 시도하면 "이미 회원가입된 학번입니다" 팝업이 뜹니다.

## 참고

- 학생 계정은 실제 이메일이 없으므로, 내부적으로 `s{학번}@students.greekquiz.local` 형태의 가짜 이메일로 Supabase Auth 계정을 만듭니다. 학생에게는 노출되지 않습니다.
- 단어 데이터는 현재 전역 공유 세트입니다(모든 그룹이 같은 `words` 테이블 사용). 그룹별로 다른 단어를 쓰게 하려면 `words` 테이블에 `group_id`를 추가하는 확장이 필요합니다.
- 한 학생이 같은 시험에 두 번 응시할 수 없도록 `attempts` 테이블에 `(exam_id, student_id)` 유니크 제약이 걸려 있습니다.
