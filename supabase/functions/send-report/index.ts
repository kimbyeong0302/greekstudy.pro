// Supabase Edge Function: 시험 결과를 엑셀로 만들어 교수 이메일로 전송
// 배포: supabase functions deploy send-report
// 필요한 시크릿: RESEND_API_KEY (supabase secrets set RESEND_API_KEY=...)

import { createClient } from "npm:@supabase/supabase-js@2";
import * as XLSX from "npm:xlsx@0.18.5";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const FROM_ADDRESS = Deno.env.get("REPORT_FROM_ADDRESS") || "onboarding@resend.dev";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS"
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders() });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.replace("Bearer ", "");
    if (!jwt) throw new Error("인증되지 않았습니다.");

    // 서비스 롤 키로 클라이언트 생성 후 JWT 검증. 이후 데이터 쿼리는 명시적 uid 검사로 권한 확인.
    const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      db: { schema: "greek_quiz" }
    });

    const { data: userData, error: userErr } = await sb.auth.getUser(jwt);
    if (userErr || !userData.user) throw new Error("사용자 확인 실패");
    const user = userData.user;
    const uid = user.id;

    // user_metadata에 role=professor 가 있어야 교수 계정
    if (user.user_metadata?.role !== "professor") throw new Error("교수 계정만 사용할 수 있습니다.");
    const professorEmail = user.email!;

    const { examId } = await req.json();
    if (!examId) throw new Error("examId가 필요합니다.");

    const { data: exam, error: examErr } = await sb.from("exams").select("*, groups(name, professor_id)").eq("id", examId).maybeSingle();
    if (examErr || !exam) throw new Error("시험을 찾을 수 없습니다.");
    if (exam.groups.professor_id !== uid) throw new Error("본인 그룹의 시험만 조회할 수 있습니다.");

    const { data: attempts, error: attErr } = await sb
      .from("attempts")
      .select("score, total, wrong_answers, submitted_at, students(student_number, name)")
      .eq("exam_id", examId)
      .order("submitted_at", { ascending: true });
    if (attErr) throw attErr;

    const rows = (attempts || []).map((a: any) => ({
      "학번": a.students.student_number,
      "이름": a.students.name,
      "점수": a.score,
      "총점": a.total,
      "틀린 단어": (a.wrong_answers || []).map((w: any) => w.word).join(", "),
      "응시 시각": new Date(a.submitted_at).toLocaleString("ko-KR")
    }));

    const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ "안내": "아직 응시 기록이 없습니다." }]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "결과");
    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
    const base64 = btoa(String.fromCharCode(...new Uint8Array(buf)));

    const groupName = exam.groups.name;
    const subject = `[${groupName}] ${exam.weeks.join(",")}주차 단어시험 결과`;

    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: FROM_ADDRESS,
        to: professorEmail,
        subject,
        html: `<p>${groupName} - ${exam.weeks.join(", ")}주차 단어시험 결과입니다. 응시자 ${rows.length}명.</p>`,
        attachments: [{
          filename: `${groupName}_${exam.weeks.join("-")}주차_결과.xlsx`,
          content: base64
        }]
      })
    });

    if (!resendRes.ok) {
      const errText = await resendRes.text();
      throw new Error("이메일 전송 실패: " + errText);
    }

    return new Response(JSON.stringify({ ok: true, count: rows.length }), {
      headers: { ...corsHeaders(), "Content-Type": "application/json" }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || String(err) }), {
      status: 400,
      headers: { ...corsHeaders(), "Content-Type": "application/json" }
    });
  }
});
