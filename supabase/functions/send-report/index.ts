// Supabase Edge Function: 시험 결과를 HTML 표로 교수 이메일에 전송
import { createClient } from "npm:@supabase/supabase-js@2";

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

    const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      db: { schema: "greek_quiz" }
    });

    const { data: userData, error: userErr } = await sb.auth.getUser(jwt);
    if (userErr || !userData.user) throw new Error("사용자 확인 실패");
    const user = userData.user;
    const uid = user.id;

    // 교수 확인: user_metadata 우선, 없으면 professors 테이블에서 직접 확인
    let isProfessor = user.user_metadata?.role === "professor";
    if (!isProfessor) {
      const { data: prof } = await sb.from("professors").select("id").eq("id", uid).maybeSingle();
      isProfessor = !!prof;
    }
    if (!isProfessor) throw new Error("교수 계정만 사용할 수 있습니다.");

    const professorEmail = user.email!;

    const { examId } = await req.json();
    if (!examId) throw new Error("examId가 필요합니다.");

    const { data: exam, error: examErr } = await sb
      .from("exams")
      .select("*, groups(name, professor_id)")
      .eq("id", examId)
      .maybeSingle();
    if (examErr || !exam) throw new Error("시험을 찾을 수 없습니다.");
    if (exam.groups.professor_id !== uid) throw new Error("본인 그룹의 시험만 조회할 수 있습니다.");

    const { data: attempts, error: attErr } = await sb
      .from("attempts")
      .select("score, total, wrong_answers, submitted_at, students(student_number, name)")
      .eq("exam_id", examId)
      .order("submitted_at", { ascending: true });
    if (attErr) throw attErr;

    const groupName = exam.groups.name;
    const weeksLabel = exam.weeks.join(", ") + "주차";
    const subject = `[${groupName}] ${weeksLabel} 단어시험 결과`;

    let tableHtml = "";
    if (!attempts || attempts.length === 0) {
      tableHtml = "<p style='color:#999;'>아직 응시 기록이 없습니다.</p>";
    } else {
      const rows = attempts.map((a: any, i: number) => `
        <tr style="background:${i % 2 === 0 ? "#fff" : "#f9f9f9"}">
          <td style="padding:8px 12px;border-bottom:1px solid #eee;">${a.students?.student_number ?? "-"}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;">${a.students?.name ?? "-"}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:center;">${a.score} / ${a.total}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;">${(a.wrong_answers || []).map((w: any) => w.word).join(", ") || "없음"}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;font-size:12px;color:#999;">${new Date(a.submitted_at).toLocaleString("ko-KR")}</td>
        </tr>`).join("");
      tableHtml = `
        <table style="width:100%;border-collapse:collapse;font-size:14px;">
          <thead>
            <tr style="background:#2e6ed6;color:#fff;">
              <th style="padding:10px 12px;text-align:left;">학번</th>
              <th style="padding:10px 12px;text-align:left;">이름</th>
              <th style="padding:10px 12px;text-align:center;">점수</th>
              <th style="padding:10px 12px;text-align:left;">틀린 단어</th>
              <th style="padding:10px 12px;text-align:left;">응시 시각</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>`;
    }

    const html = `
<div style="font-family:-apple-system,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;max-width:700px;margin:0 auto;padding:32px 24px;background:#fff;">
  <p style="margin:0 0 4px;font-size:12px;color:#999;">헬라어 단어시험</p>
  <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#222;">${groupName} — ${weeksLabel} 결과</h2>
  <p style="margin:0 0 24px;font-size:14px;color:#555;">응시자 ${attempts?.length ?? 0}명 · ${exam.level}단계</p>
  ${tableHtml}
  <hr style="border:none;border-top:1px solid #eee;margin:28px 0 16px;">
  <p style="margin:0;font-size:12px;color:#ccc;">헬라어 단어시험 시스템 자동 발송</p>
</div>`;

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
        html
      })
    });

    if (!resendRes.ok) {
      const errText = await resendRes.text();
      throw new Error("이메일 전송 실패: " + errText);
    }

    return new Response(JSON.stringify({ ok: true, count: attempts?.length ?? 0 }), {
      headers: { ...corsHeaders(), "Content-Type": "application/json" }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || String(err) }), {
      status: 400,
      headers: { ...corsHeaders(), "Content-Type": "application/json" }
    });
  }
});
