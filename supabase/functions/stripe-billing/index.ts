import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const PRICES: Record<string, string> = {
  starter: "price_1UCnqZB8e0Rwsso5p3SBCC4A",
  pro: "price_1UCnqxB8e0Rwsso5c9NhRbK1",
  elite: "price_1UCnrBB8e0Rwsso5wxwVmQg2",
};

function cors(req: Request) {
  const origin = req.headers.get("origin") || "https://resellgo.vercel.app";
  const allowed = /^https:\/\/([a-z0-9-]+\.)*vercel\.app$/.test(origin) || /^https:\/\/([a-z0-9-]+\.)*chatgpt\.site$/.test(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  return {
    "Access-Control-Allow-Origin": allowed ? origin : "https://resellgo.vercel.app",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(req), "Content-Type": "application/json" },
  });
}

async function stripeRequest(path: string, params: URLSearchParams) {
  const secret = Deno.env.get("STRIPE_SECRET_KEY");
  if (!secret) throw new Error("Stripe n'est pas encore configuré.");
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error?.message || "Stripe a refusé la demande.");
  return data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return json(req, { error: "Méthode non autorisée." }, 405);

  try {
    const authorization = req.headers.get("authorization");
    if (!authorization?.startsWith("Bearer ")) return json(req, { error: "Connexion requise." }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const token = authorization.slice(7);
    const { data: authData, error: authError } = await supabase.auth.getUser(token);
    const user = authData.user;
    if (authError || !user?.email) return json(req, { error: "Session invalide." }, 401);

    const input = await req.json().catch(() => ({}));
    const requestOrigin = req.headers.get("origin") || "https://resellgo.vercel.app";
    const siteUrl = (/^https:\/\/([a-z0-9-]+\.)*vercel\.app$/.test(requestOrigin) || /^https:\/\/([a-z0-9-]+\.)*chatgpt\.site$/.test(requestOrigin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(requestOrigin)) ? requestOrigin : "https://resellgo.vercel.app";
    const action = String(input.action || "checkout");
    const { data: access, error: accessError } = await supabase
      .from("access_control")
      .select("stripe_customer_id,status")
      .eq("user_id", user.id)
      .single();
    if (accessError || !access || access.status !== "active") return json(req, { error: "Accès au compte indisponible." }, 403);

    if (action === "portal") {
      if (!access.stripe_customer_id) return json(req, { error: "Aucun abonnement Stripe à gérer." }, 400);
      const params = new URLSearchParams({ customer: access.stripe_customer_id, return_url: `${siteUrl}/app.html` });
      const session = await stripeRequest("billing_portal/sessions", params);
      return json(req, { url: session.url });
    }

    const plan = String(input.plan || "");
    const price = PRICES[plan];
    if (!price) return json(req, { error: "Offre invalide." }, 400);

    const params = new URLSearchParams({
      mode: "subscription",
      "line_items[0][price]": price,
      "line_items[0][quantity]": "1",
      client_reference_id: user.id,
      success_url: `${siteUrl}/app.html?billing=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl}/app.html?billing=cancelled`,
      allow_promotion_codes: "true",
      "metadata[user_id]": user.id,
      "metadata[plan]": plan,
      "subscription_data[metadata][user_id]": user.id,
      "subscription_data[metadata][plan]": plan,
    });
    if (access.stripe_customer_id) params.set("customer", access.stripe_customer_id);
    else params.set("customer_email", user.email);

    const session = await stripeRequest("checkout/sessions", params);
    return json(req, { url: session.url });
  } catch (error) {
    console.error(error);
    return json(req, { error: error instanceof Error ? error.message : "Erreur de paiement." }, 500);
  }
});
