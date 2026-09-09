// Supabase Edge Function: 관리자가 특정 사용자 비밀번호를 "0000"으로 초기화
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
    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.replace("Bearer ", "");
    if (!jwt) throw new Error("인증되지 않았습니다.");

    const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data: userData, error: userErr } = await sb.auth.getUser(jwt);
    if (userErr || !userData.user) throw new Error("사용자 확인 실패");

    if (userData.user.user_metadata?.role !== "admin") {
      throw new Error("관리자 계정만 사용할 수 있습니다.");
    }

    const { userId } = await req.json();
    if (!userId) throw new Error("userId가 필요합니다.");

    const { error: resetErr } = await sb.auth.admin.updateUserById(userId, { password: "0000" });
    if (resetErr) throw new Error("초기화 실패: " + resetErr.message);

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
