// Supabase Edge Function: 학생 계정을 이메일 인증 없이 즉시 사용 가능하게 생성합니다.
// 학생은 실제 이메일이 없는(가짜 이메일 s{학번}@students.greekquiz.local) 계정이라
// 인증 메일을 받아 클릭할 방법이 없으므로, 관리자 권한(service role)으로 이미
// 인증된 상태의 계정을 직접 만듭니다. 교수는 실제 이메일을 쓰므로 이 함수를 거치지
// 않고 클라이언트에서 sb.auth.signUp()을 그대로 사용해 토블 앱과 동일한 이메일
// 인증 절차(가입 → 인증 메일 링크 클릭 → 로그인)를 따릅니다.
// 배포: supabase functions deploy signup

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const body = await req.json();
    const { role, name, password, studentNumber } = body;

    if (role !== "student") throw new Error("이 함수는 학생 가입 전용입니다.");
    if (!name || !password || !studentNumber) throw new Error("필수 항목이 비어 있습니다.");

    const email = `s${studentNumber}@students.greekquiz.local`;
    const metadata = { role: "student", name, student_number: studentNumber };

    // email_confirm: true 로 만들면 별도의 인증 메일 없이 바로 로그인 가능한 계정이 됩니다.
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: metadata
    });

    if (error) {
      // 이미 가입된 학번(=가짜 이메일 중복)이면 알기 쉬운 한글 메시지로 바꿔서 전달
      const msg = (error.message || "").toLowerCase();
      if (msg.includes("already") || (error as any).code === "email_exists") {
        throw new Error("이미 회원가입된 학번입니다.");
      }
      throw new Error(error.message);
    }

    return new Response(JSON.stringify({ ok: true, userId: data.user?.id }), {
      headers: { ...corsHeaders(), "Content-Type": "application/json" }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || String(err) }), {
      status: 400,
      headers: { ...corsHeaders(), "Content-Type": "application/json" }
    });
  }
});
