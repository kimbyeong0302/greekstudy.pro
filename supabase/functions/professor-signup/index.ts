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
        subject: "[토블.kr] 이메일 인증을 완료해주세요",
        html: `
<div style="font-family:-apple-system,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;max-width:480px;margin:0 auto;padding:40px 24px;background:#fff;">
  <p style="margin:0 0 4px;font-size:13px;color:#999;letter-spacing:0.5px;">토블.kr</p>
  <h2 style="margin:0 0 24px;font-size:22px;font-weight:700;color:#222;">이메일 인증</h2>
  <p style="margin:0 0 16px;font-size:15px;color:#333;">안녕하세요, <strong>${name}</strong>님 👋</p>
  <p style="margin:0 0 28px;font-size:15px;color:#444;line-height:1.7;">
    헬라어 단어 시험 교수 계정 가입이 거의 완료되었습니다.<br>
    아래 버튼을 클릭하면 이메일 인증이 완료되고 바로 로그인하실 수 있습니다.
  </p>
  <div style="text-align:center;margin:0 0 32px;">
    <a href="${link}" style="display:inline-block;padding:14px 36px;background:#2e6ed6;color:#fff;text-decoration:none;border-radius:12px;font-size:15px;font-weight:700;letter-spacing:0.2px;">
      이메일 인증 완료하기
    </a>
  </div>
  <p style="margin:0 0 6px;font-size:12px;color:#aaa;">버튼이 클릭되지 않는 경우, 아래 링크를 복사해 브라우저에 붙여넣어 주세요.</p>
  <p style="margin:0 0 32px;font-size:12px;color:#bbb;word-break:break-all;">${link}</p>
  <hr style="border:none;border-top:1px solid #eee;margin:0 0 20px;">
  <p style="margin:0;font-size:12px;color:#ccc;">본인이 요청하지 않은 경우 이 메일을 무시하셔도 됩니다. — 토블.kr</p>
</div>`
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
