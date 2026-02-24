import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Deterministic hash for dedup — SHA-256 of canonical fields */
async function computeRawHash(
  userId: string,
  deviceUid: string,
  type: string,
  ts: string,
  value: number | null,
): Promise<string> {
  const input = `${userId}|${deviceUid}|${type}|${ts}|${value ?? ""}`;
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

interface SampleInput {
  type: string;
  ts: string;
  end_ts?: string;
  value?: number | null;
  payload_json?: Record<string, unknown>;
  source?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // 1. Auth
  const authHeader =
    req.headers.get("Authorization") ?? req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return json({ error: "Unauthorized — Bearer token required" }, 401);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );

  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();
  if (userErr || !user) {
    return json({ error: "Invalid or expired token" }, 401);
  }
  const userId = user.id;

  // 2. Parse body
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const deviceUid = typeof body.device_uid === "string" ? body.device_uid.trim() : "";
  const model = typeof body.model === "string" ? body.model.trim() : "";
  const vendor = typeof body.vendor === "string" ? body.vendor.trim() : "jstyle";
  const fwVersion = typeof body.fw_version === "string" ? body.fw_version.trim() : null;
  const samples = Array.isArray(body.samples) ? body.samples as SampleInput[] : [];

  if (!deviceUid) return json({ error: "device_uid is required" }, 400);
  if (!model) return json({ error: "model is required" }, 400);
  if (samples.length === 0) return json({ error: "samples array is required and must not be empty" }, 400);
  if (samples.length > 500) return json({ error: "Max 500 samples per batch" }, 400);

  // 3. Upsert device
  const { data: deviceData, error: deviceErr } = await supabase
    .from("devices")
    .upsert(
      {
        user_id: userId,
        device_uid: deviceUid,
        vendor,
        model,
        fw_version: fwVersion,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: "user_id,device_uid" },
    )
    .select("id")
    .single();

  if (deviceErr || !deviceData) {
    return json({ error: deviceErr?.message ?? "Failed to upsert device" }, 500);
  }
  const deviceId = deviceData.id;

  // 4. Build rows with hashes
  let inserted = 0;
  let duplicates = 0;
  let errors = 0;
  const typesIngested = new Set<string>();

  const rows = await Promise.all(
    samples.map(async (s) => {
      const rawHash = await computeRawHash(
        userId,
        deviceUid,
        s.type,
        s.ts,
        s.value ?? null,
      );
      return {
        user_id: userId,
        device_id: deviceId,
        type: s.type,
        ts: s.ts,
        end_ts: s.end_ts ?? null,
        value: s.value ?? null,
        payload_json: s.payload_json ?? null,
        source: s.source ?? "jstyle",
        raw_hash: rawHash,
      };
    }),
  );

  // 5. Bulk upsert — skip duplicates via ON CONFLICT DO NOTHING semantics
  // We insert in chunks to avoid payload limits
  const CHUNK_SIZE = 50;
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE);
    const { data, error } = await supabase
      .from("biomarker_samples")
      .upsert(chunk, { onConflict: "raw_hash", ignoreDuplicates: true })
      .select("id, type");

    if (error) {
      console.error("Chunk insert error:", error.message);
      errors += chunk.length;
    } else {
      inserted += (data?.length ?? 0);
      duplicates += chunk.length - (data?.length ?? 0);
      data?.forEach((r: { type: string }) => typesIngested.add(r.type));
    }
  }

  // 6. Update sync state
  const cursorByType: Record<string, string> = {};
  for (const t of typesIngested) {
    const latestSample = rows
      .filter((r) => r.type === t)
      .sort((a, b) => b.ts.localeCompare(a.ts))[0];
    if (latestSample) cursorByType[t] = latestSample.ts;
  }

  await supabase.from("device_sync_state").upsert(
    {
      user_id: userId,
      device_id: deviceId,
      last_sync_at: new Date().toISOString(),
      last_success_at: errors === 0 ? new Date().toISOString() : undefined,
      last_error: errors > 0 ? `${errors} samples failed` : null,
      cursor_by_type: cursorByType,
    },
    { onConflict: "user_id,device_id" },
  );

  return json({
    success: true,
    device_id: deviceId,
    inserted,
    duplicates,
    errors,
    types: Array.from(typesIngested),
  });
});
