-- 그룹 가입 코드를 "교수가 직접 정하는 숫자 4자리"로 바꿉니다.
-- 기존에는 서버가 무작위 영숫자 6자리를 자동 생성했지만, 이제는 교수가 직접
-- 숫자 4자리를 입력해서 그룹을 만듭니다. DB에도 형식을 강제해서 잘못된 값이
-- 들어가는 걸 막습니다.
--
-- 참고: 지금까지 교수 로그인이 정상 동작한 적이 없어서 groups 테이블에 유효한
-- 데이터가 거의 없을 가능성이 높습니다. 혹시 기존 코드(6자리 영숫자 등)가 있는
-- 그룹이 있다면, 이 마이그레이션 실행 전에 지우거나 숫자 4자리로 갱신해두세요.
-- 예: delete from greek_quiz.groups where join_code !~ '^[0-9]{4}$';

alter table greek_quiz.groups
  add constraint groups_join_code_format check (join_code ~ '^[0-9]{4}$');

-- join_code에 대한 unique 제약은 원래 스키마에 이미 있어야 합니다(없다면 아래 실행):
-- alter table greek_quiz.groups add constraint groups_join_code_unique unique (join_code);
