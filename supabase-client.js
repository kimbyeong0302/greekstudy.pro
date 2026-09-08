// 공통 Supabase 클라이언트 및 헬퍼 함수
// 토블 앱과 같은 Supabase 프로젝트를 재사용하되, greek_quiz 스키마로 분리되어 있습니다.

const SUPABASE_URL = 'https://tepsuxyfyrkylyhsngwo.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRlcHN1eHlmeXJreWx5aHNuZ3dvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc1MTk3ODgsImV4cCI6MjEwMzA5NTc4OH0.tRCXepurFgWt_hSVuSnzhCFxzcj8qJdGwm6QGGIt96Q';

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  db: { schema: 'greek_quiz' }
});

// 학생은 실제 이메일이 없으므로, 학번을 이용한 가짜 이메일로 Supabase Auth 계정을 만듭니다.
function studentEmail(studentNumber) {
  return `s${studentNumber}@students.greekquiz.local`;
}

// 학생은 실제 이메일이 없어서(가짜 이메일) 인증 메일을 받을 방법이 없으므로,
// 학생 계정만 Edge Function(signup)으로 즉시 활성화 상태로 만듭니다.
async function callSignupFunction(payload) {
  const res = await fetch(SUPABASE_URL + '/functions/v1/signup', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': 'Bearer ' + SUPABASE_ANON_KEY
    },
    body: JSON.stringify(payload)
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || '회원가입에 실패했습니다.');
  return json;
}

const Auth = {
  // 교수는 실제 이메일을 쓰므로, 토블 앱과 동일하게 Supabase의 기본 이메일 인증
  // 절차(가입 → 인증 메일의 링크 클릭 → 로그인)를 그대로 사용합니다.
  async signUpProfessor(email, password, name) {
    return sb.auth.signUp({
      email, password,
      options: { data: { role: 'professor', name } }
    });
  },
  async signUpStudent(studentNumber, name, password) {
    try {
      await callSignupFunction({ role: 'student', studentNumber, name, password });
      return { error: null };
    } catch (err) {
      return { error: err };
    }
  },
  async signInProfessor(email, password) {
    return sb.auth.signInWithPassword({ email, password });
  },
  async signInStudent(studentNumber, password) {
    return sb.auth.signInWithPassword({ email: studentEmail(studentNumber), password });
  },
  async signOut() {
    return sb.auth.signOut();
  },
  async getSession() {
    const { data } = await sb.auth.getSession();
    return data.session;
  },
  // 로그인한 사용자가 교수/학생/관리자 중 무엇인지 확인
  async getRole(userId) {
    const { data: prof } = await sb.from('professors').select('id').eq('id', userId).maybeSingle();
    if (prof) return 'professor';
    const { data: stu } = await sb.from('students').select('id, role').eq('id', userId).maybeSingle();
    if (stu) return stu.role === 'admin' ? 'admin' : 'student';
    return null;
  }
};

const Api = {
  // ---- 교수용 ----
  async createGroup(professorId, name) {
    const code = Math.random().toString(36).slice(2, 8).toUpperCase();
    return sb.from('groups').insert({ professor_id: professorId, name, join_code: code }).select().single();
  },
  async myGroups(professorId) {
    return sb.from('groups').select('*').eq('professor_id', professorId).order('created_at', { ascending: false });
  },
  async groupMembers(groupId) {
    return sb.from('group_members')
      .select('joined_at, students(id, student_number, name)')
      .eq('group_id', groupId);
  },
  async createExam(groupId, { weeks, level, mode, timeLimitSec }) {
    return sb.from('exams').insert({
      group_id: groupId, weeks, level, mode, time_limit_sec: timeLimitSec, active: true
    }).select().single();
  },
  async examsForGroup(groupId) {
    return sb.from('exams').select('*').eq('group_id', groupId).order('created_at', { ascending: false });
  },
  async attemptsForExam(examId) {
    return sb.from('attempts')
      .select('score, total, wrong_answers, submitted_at, students(student_number, name)')
      .eq('exam_id', examId)
      .order('submitted_at', { ascending: false });
  },
  async setExamActive(examId, active) {
    return sb.from('exams').update({ active }).eq('id', examId);
  },

  // ---- 학생용 ----
  async joinGroupByCode(code) {
    return sb.rpc('join_group_by_code', { p_code: code });
  },
  async myGroupsAsStudent(studentId) {
    return sb.from('group_members')
      .select('joined_at, groups(id, name)')
      .eq('student_id', studentId);
  },
  async activeExamsForStudent(studentId) {
    // 학생이 속한 그룹들의 활성 시험만 조회 (RLS가 실제 접근 범위를 보장)
    const { data: memberships } = await sb.from('group_members').select('group_id').eq('student_id', studentId);
    const groupIds = (memberships || []).map(m => m.group_id);
    if (groupIds.length === 0) return { data: [], error: null };
    return sb.from('exams').select('*, groups(name)').in('group_id', groupIds).eq('active', true);
  },
  async wordsForWeeks(weeks) {
    return sb.from('words').select('*').in('week', weeks);
  },
  async submitAttempt(examId, studentId, score, total, wrongAnswers) {
    return sb.from('attempts').insert({
      exam_id: examId, student_id: studentId, score, total, wrong_answers: wrongAnswers
    });
  },
  async myAttempt(examId, studentId) {
    return sb.from('attempts').select('*').eq('exam_id', examId).eq('student_id', studentId).maybeSingle();
  },

  // ---- 관리자용 (앱 소유자 전용, RLS가 role='admin'인 계정만 허용) ----
  async adminAllProfessors() {
    return sb.from('professors').select('*').order('created_at', { ascending: false });
  },
  async adminAllGroups() {
    return sb.from('groups').select('*, professors(name, email)').order('created_at', { ascending: false });
  },
  async adminAllStudents() {
    return sb.from('students').select('*').order('created_at', { ascending: false });
  },
  async adminAllExamsWithAttemptCount() {
    return sb.from('exams').select('*, groups(name), attempts(count)').order('created_at', { ascending: false });
  }
};
