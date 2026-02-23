import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/** Validate day format YYYY-MM-DD */
function isValidDay(d: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(Date.parse(d));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const json = (body: Record<string, unknown>, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  // ── 1. JWT obrigatório ────────────────────────────────────────────
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return json({ error: "Unauthorized — Bearer token required" }, 401);
  }

  // ── 2. Criar client com ANON_KEY + JWT do caller (RLS ativa) ─────
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } }
  );

  // ── 3. Validar token e extrair user_id ────────────────────────────
  const { data: { user }, error: userErr } = await supabase.auth.getUser();
  if (userErr || !user) {
    return json({ error: "Invalid or expired token" }, 401);
  }
  const userId = user.id; // ALWAYS from JWT, never from body

  // ── 4. Parse + validar body ───────────────────────────────────────
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const { day, source_provider, metrics } = body as {
    day?: string;
    source_provider?: string;
    metrics?: Record<string, unknown>;
  };

  if (!day || !isValidDay(day)) {
    return json({ error: "day is required and must be YYYY-MM-DD" }, 400);
  }
  if (!metrics || typeof metrics !== "object" || Array.isArray(metrics)) {
    return json({ error: "metrics must be a non-empty object" }, 400);
  }
  if (Object.keys(metrics).length === 0) {
    return json({ error: "metrics must have at least one key" }, 400);
  }
  if (Object.keys(metrics).length > 64) {
    return json({ error: "metrics exceeds 64-key limit" }, 400);
  }

  // ── 5. Upsert via RLS (anon + user JWT) ───────────────────────────
  try {
    const { data, error } = await supabase
      .from("ring_daily_data")
      .upsert(
        [{
          user_id: userId,
          day,
          source_provider: (source_provider as string) || "api",
          metrics,
        }],
        { onConflict: "user_id,day,source_provider" }
      )
      .select();

    if (error) {
      console.error("[ingest] upsert error:", error);
      return json({ error: error.message }, 500);
    }

    return json({ success: true, data });
  } catch (error) {
    console.error("[ingest] exception:", error);
    return json({ error: (error as Error).message }, 500);
  }
});
