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

## 배포 전 체크리스트

1. **DB 마이그레이션 적용**: `greek_quiz_schema.sql`, `seed_words.sql`을 Supabase 프로젝트(`tepsuxyfyrkylyhsngwo`)에 적용
2. **Edge Function 배포**: `supabase functions deploy send-report`
3. **Resend 시크릿 등록**: `supabase secrets set RESEND_API_KEY=발급받은키`
   - 자체 도메인을 아직 Resend에 인증하지 않았다면, 발신 주소는 기본값(`onboarding@resend.dev`)으로 테스트 가능
   - 도메인 인증 후에는 `supabase secrets set REPORT_FROM_ADDRESS=noreply@내도메인.kr`
4. **GitHub Pages 배포**: 이 폴더를 새 저장소(`greekquiz-pro`)에 올리고 GitHub Pages 활성화

## 참고

- 학생 계정은 실제 이메일이 없으므로, 내부적으로 `s{학번}@students.greekquiz.local` 형태의 가짜 이메일로 Supabase Auth 계정을 만듭니다. 학생에게는 노출되지 않습니다.
- 단어 데이터는 현재 전역 공유 세트입니다(모든 그룹이 같은 `words` 테이블 사용). 그룹별로 다른 단어를 쓰게 하려면 `words` 테이블에 `group_id`를 추가하는 확장이 필요합니다.
- 한 학생이 같은 시험에 두 번 응시할 수 없도록 `attempts` 테이블에 `(exam_id, student_id)` 유니크 제약이 걸려 있습니다.
