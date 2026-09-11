import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

type Json = Record<string, unknown>;
const ALLOWED_ORIGIN = /^https:\/\/([a-z0-9-]+\.)*(vercel\.app|chatgpt\.site)$/;

function cors(req: Request) {
  const origin = req.headers.get("origin") || "https://resellgo.arno-dewame288614.chatgpt.site";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN.test(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) ? origin : "https://resellgo.arno-dewame288614.chatgpt.site",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-cron-token",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}

function respond(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors(req), "Content-Type": "application/json" } });
}

function numberOf(row: Json, keys: string[], fallback = 0) {
  for (const key of keys) {
    const value = Number(row[key]);
    if (Number.isFinite(value)) return value;
  }
  return fallback;
}

function textOf(row: Json, keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return "";
}

function normalize(row: Json, source: Json) {
  const url = textOf(row, ["url", "product_url", "item_url", "link"]);
  const title = textOf(row, ["name", "title", "product_name", "item_name"]);
  const buyPrice = numberOf(row, ["price", "price_numeric", "item_price", "discounted_price"]);
  if (!url || !title || buyPrice <= 0) return null;
  const externalId = textOf(row, ["sku", "id", "item_id", "product_id"]) || url;
  const category = textOf(row, ["category", "category_name", "catalog_name"]) || String(source.category || "Vinted");
  const multiplier = Number(source.estimated_resale_multiplier || 1.35);
  const favorites = numberOf(row, ["favorites_count", "favourites_count", "favorite_count"]);
  const demand = Math.min(100, Math.max(35, 45 + Math.round(Math.log10(favorites + 1) * 22)));
  return {
    user_id: source.user_id,
    source: "authorized_api",
    external_id: `brightdata:${externalId}`,
    external_url: url,
    title,
    brand: textOf(row, ["brand", "brand_name"]) || null,
    category,
    size: textOf(row, ["size", "size_title"]) || null,
    item_condition: textOf(row, ["condition", "status", "item_condition"]) || null,
    buy_price: buyPrice,
    buyer_fee: Number(source.buyer_fee || 0),
    shipping: Number(source.shipping || 0),
    estimated_resale: Math.round(buyPrice * multiplier * 100) / 100,
    seller_fee: 0,
    confidence_score: 60,
    demand_score: demand,
    resale_days_estimate: demand >= 75 ? 7 : demand >= 55 ? 14 : 30,
    observed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function snapshotId(data: unknown) {
  if (!data || typeof data !== "object") return "";
  const row = data as Json;
  return textOf(row, ["snapshot_id", "snapshotId", "id"]);
}

async function brightData(path: string, token: string, init?: RequestInit) {
  const response = await fetch(`https://api.brightdata.com${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  const raw = await response.text();
  let data: unknown = raw;
  try { data = raw ? JSON.parse(raw) : {}; } catch { /* retain diagnostic text */ }
  if (!response.ok) throw new Error(`Bright Data ${response.status}: ${typeof data === "string" ? data.slice(0, 300) : JSON.stringify(data).slice(0, 300)}`);
  return data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return respond(req, { error: "Méthode non autorisée." }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  let callerUserId: string | null = null;

  try {
    const cronToken = req.headers.get("x-cron-token");
    if (cronToken) {
      const { data: valid, error } = await admin.rpc("validate_market_sync_cron_token", { candidate: cronToken });
      if (error || valid !== true) return respond(req, { error: "Appel planifié non autorisé." }, 401);
    } else {
      const authorization = req.headers.get("authorization");
      if (!authorization?.startsWith("Bearer ")) return respond(req, { error: "Connexion requise." }, 401);
      const { data, error } = await admin.auth.getUser(authorization.slice(7));
      if (error || !data.user) return respond(req, { error: "Session invalide." }, 401);
      callerUserId = data.user.id;
    }

    const input = await req.json().catch(() => ({}));
    let query = admin.from("market_sync_sources").select("*").eq("enabled", true);
    if (callerUserId) query = query.eq("user_id", callerUserId);
    else query = query.lte("next_run_at", new Date().toISOString());
    if (input.source_id) query = query.eq("id", String(input.source_id));
    const { data: sources, error: sourceError } = await query.limit(25);
    if (sourceError) throw sourceError;

    const token = Deno.env.get("BRIGHTDATA_API_TOKEN");
    const datasetId = Deno.env.get("BRIGHTDATA_DATASET_ID");
    if (!token || !datasetId) {
      if (sources?.length) await admin.from("market_sync_sources").update({ last_status: "not_configured", last_error: "Clé ou dataset Bright Data manquant.", updated_at: new Date().toISOString() }).in("id", sources.map((s) => s.id));
      return respond(req, { ok: false, code: "provider_not_configured", message: "Ajoute BRIGHTDATA_API_TOKEN et BRIGHTDATA_DATASET_ID dans les secrets Supabase.", sources: sources?.length || 0 }, 503);
    }

    const results: Json[] = [];
    for (const source of sources || []) {
      const started = new Date().toISOString();
      const { data: pending } = await admin.from("market_sync_runs").select("id,snapshot_id").eq("source_id", source.id).eq("status", "pending").order("created_at", { ascending: false }).limit(1).maybeSingle();
      let run = pending;
      let snap = pending?.snapshot_id || "";
      let rows: unknown[] = [];
      if (!run) {
        const created = await admin.from("market_sync_runs").insert({ source_id: source.id, user_id: source.user_id, status: "running", started_at: started }).select("id,snapshot_id").single();
        if (created.error) throw created.error;
        run = created.data;
      }
      await admin.from("market_sync_sources").update({ last_status: "running", last_error: null, last_run_at: started }).eq("id", source.id);
      try {
        if (snap) {
          const downloaded = await brightData(`/datasets/v3/snapshot/${encodeURIComponent(snap)}?format=json`, token);
          if (Array.isArray(downloaded)) rows = downloaded;
          else {
            const status = textOf(downloaded as Json, ["status", "state"]).toLowerCase();
            if (["failed", "error"].includes(status)) throw new Error("La collecte Bright Data a échoué.");
          }
        } else {
          const triggered = await brightData(`/datasets/v3/trigger?dataset_id=${encodeURIComponent(datasetId)}&format=json`, token, { method: "POST", body: JSON.stringify([{ url: source.search_url }]) });
          rows = Array.isArray(triggered) ? triggered : [];
          snap = snapshotId(triggered);
        }
        if (!rows.length && snap) {
          for (let attempt = 0; attempt < 8; attempt++) {
            await new Promise((resolve) => setTimeout(resolve, 1500));
            const downloaded = await brightData(`/datasets/v3/snapshot/${encodeURIComponent(snap)}?format=json`, token);
            if (Array.isArray(downloaded)) { rows = downloaded; break; }
            const status = textOf(downloaded as Json, ["status", "state"]).toLowerCase();
            if (["failed", "error"].includes(status)) throw new Error("La collecte Bright Data a échoué.");
          }
        }
        if (!rows.length && snap) {
          const nextCheck = new Date(Date.now() + 5 * 60000).toISOString();
          await admin.from("market_sync_runs").update({ status: "pending", snapshot_id: snap }).eq("id", run.id);
          await admin.from("market_sync_sources").update({ last_status: "pending", last_error: null, next_run_at: nextCheck, updated_at: new Date().toISOString() }).eq("id", source.id);
          results.push({ source_id: source.id, status: "pending", snapshot_id: snap });
          continue;
        }
        const normalized = rows.map((row) => normalize(row as Json, source)).filter(Boolean);
        let imported = 0;
        if (normalized.length) {
          const { data, error } = await admin.from("market_opportunities").upsert(normalized, { onConflict: "user_id,source,external_id" }).select("id,title,net_margin,roi,opportunity_score");
          if (error) throw error;
          imported = data?.length || 0;
          const strong = (data || []).filter((x) => Number(x.opportunity_score) >= 70).slice(0, 10);
          if (strong.length) await admin.from("notifications").insert(strong.map((x) => ({ user_id: source.user_id, title: `Radar : ${x.title}`, body: `Score ${x.opportunity_score}/100 · marge estimée ${Number(x.net_margin).toFixed(2)} € · ROI ${Number(x.roi).toFixed(0)} %.`, type: "market_opportunity" })));
        }
        const done = new Date().toISOString();
        const nextRun = new Date(Date.now() + Number(source.interval_minutes) * 60000).toISOString();
        await admin.from("market_sync_runs").update({ status: "success", snapshot_id: snap || null, fetched_count: rows.length, imported_count: imported, completed_at: done }).eq("id", run.id);
        await admin.from("market_sync_sources").update({ last_status: "success", last_error: null, next_run_at: nextRun, updated_at: done }).eq("id", source.id);
        results.push({ source_id: source.id, status: "success", fetched: rows.length, imported });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Erreur de synchronisation.";
        const done = new Date().toISOString();
        await admin.from("market_sync_runs").update({ status: "error", error_message: message.slice(0, 1000), completed_at: done }).eq("id", run.id);
        await admin.from("market_sync_sources").update({ last_status: "error", last_error: message.slice(0, 500), next_run_at: new Date(Date.now() + Number(source.interval_minutes) * 60000).toISOString(), updated_at: done }).eq("id", source.id);
        results.push({ source_id: source.id, status: "error", error: message });
      }
    }
    return respond(req, { ok: true, processed: results.length, results });
  } catch (error) {
    console.error(error);
    return respond(req, { error: error instanceof Error ? error.message : "Erreur de synchronisation." }, 500);
  }
});
