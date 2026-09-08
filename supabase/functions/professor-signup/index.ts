// Supabase Edge Function: 교수 회원가입 + 인증 메일을 Resend로 직접 발송합니다.
// Supabase Auth의 기본 SMTP 설정에 의존하지 않고, 인증 "링크"만 Supabase 관리자
// API로 생성한 뒤, 실제 이메일 발송은 send-report와 동일한 방식으로 Resend API를
// 직접 호출해서 처리합니다. 이메일이 왜 안 오는지 SMTP 설정을 계속 디버깅하는 대신,
// 발송 경로 자체를 우리가 직접 통제하는 방식입니다.
// 배포: supabase functions deploy professor-signup

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const FROM_ADDRESS = Deno.env.get("REPORT_FROM_ADDRESS") || "onboarding@resend.dev";
// 인증 완료 후 돌아갈 주소. Supabase Auth 설정의 Redirect URLs 목록에 이 주소(또는
// 이 주소가 포함되는 패턴, 예: https://kimbyeong0302.github.io/greekstudy.pro/*)가
// 등록되어 있어야 합니다 (Authentication → URL Configuration).
const SITE_URL = Deno.env.get("SITE_URL") || "https://kimbyeong0302.github.io/greekstudy.pro/index.html";

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
    const { email, password, name } = await req.json();
    if (!email || !password || !name) throw new Error("모든 항목을 입력해주세요.");

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // 계정 생성 + 인증 링크 생성을 한 번에 처리 (아직 이메일 인증 전 상태로 생성됨)
    const { data, error } = await admin.auth.admin.generateLink({
      type: "signup",
      email,
      password,
      options: {
        data: { role: "professor", name },
        redirectTo: SITE_URL
      }
    });

    if (error) {
      const msg = (error.message || "").toLowerCase();
      if (msg.includes("already")) throw new Error("이미 가입된 이메일입니다.");
      throw new Error(error.message);
    }

    const link = data.properties?.action_link;
    if (!link) throw new Error("인증 링크 생성에 실패했습니다.");

    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: FROM_ADDRESS,
        to: email,
        subject: "[헬라어 단어 시험] 이메일 인증을 완료해주세요",
        html: `<p>안녕하세요 ${name}님,</p>
               <p>헬라어 단어 시험 교수 계정 가입을 완료하려면 아래 버튼을 눌러 이메일 인증을 완료해주세요.</p>
               <p><a href="${link}" style="display:inline-block;padding:12px 20px;background:#2e6ed6;color:#fff;text-decoration:none;border-radius:8px;">이메일 인증하기</a></p>
               <p>버튼이 안 눌리면 이 링크를 브라우저에 붙여넣어주세요: ${link}</p>`
      })
    });

    if (!resendRes.ok) {
      const errText = await resendRes.text();
      throw new Error("인증 메일 발송 실패: " + errText);
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders(), "Content-Type": "application/json" }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || String(err) }), {
      status: 400,
      headers: { ...corsHeaders(), "Content-Type": "application/json" }
    });
  }
});
