import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const PRICE_TO_PLAN: Record<string, string> = {
  price_1UCnqZB8e0Rwsso5p3SBCC4A: "starter",
  price_1UCnqxB8e0Rwsso5c9NhRbK1: "pro",
  price_1UCnrBB8e0Rwsso5wxwVmQg2: "elite",
};

function bytesToHex(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

async function verifySignature(body: string, signature: string, secret: string) {
  const values = Object.fromEntries(signature.split(",").map((part) => part.split("=", 2)));
  const timestamp = Number(values.t);
  if (!timestamp || Math.abs(Date.now() / 1000 - timestamp) > 300 || !values.v1) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${body}`));
  return constantTimeEqual(bytesToHex(digest), values.v1);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const body = await req.text();
  const signature = req.headers.get("stripe-signature") || "";
  const secret = Deno.env.get("STRIPE_WEBHOOK_SECRET") || "";
  if (!secret || !(await verifySignature(body, signature, secret))) return new Response("Invalid signature", { status: 400 });

  const event = JSON.parse(body);
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { error: eventError } = await supabase.from("billing_events").insert({
    id: event.id,
    event_type: event.type,
    payload: { livemode: Boolean(event.livemode), api_version: event.api_version || null },
  });
  if (eventError?.code === "23505") return Response.json({ received: true, duplicate: true });
  if (eventError) return new Response("Event storage failed", { status: 500 });

  try {
    const object = event.data.object;
    if (event.type === "checkout.session.completed") {
      const userId = object.metadata?.user_id || object.client_reference_id;
      const plan = object.metadata?.plan;
      if (userId && ["starter", "pro", "elite"].includes(plan)) {
        const { error } = await supabase.from("access_control").update({
          plan,
          stripe_customer_id: object.customer,
          stripe_subscription_id: object.subscription,
          subscription_status: "active",
          updated_at: new Date().toISOString(),
        }).eq("user_id", userId);
        if (error) throw error;
      }
    }

    if (["customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"].includes(event.type)) {
      const userId = object.metadata?.user_id;
      const priceId = object.items?.data?.[0]?.price?.id || null;
      const plan = object.metadata?.plan || PRICE_TO_PLAN[priceId] || "free";
      if (userId) {
        const status = event.type === "customer.subscription.deleted" ? "canceled" : object.status;
        const active = ["active", "trialing"].includes(status);
        const periodEnd = object.current_period_end || object.items?.data?.[0]?.current_period_end;
        const { error } = await supabase.from("access_control").update({
          plan: active ? plan : "free",
          stripe_customer_id: object.customer,
          stripe_subscription_id: object.id,
          stripe_price_id: priceId,
          subscription_status: status,
          current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
          updated_at: new Date().toISOString(),
        }).eq("user_id", userId);
        if (error) throw error;
      }
    }
  } catch (error) {
    console.error(error);
    await supabase.from("billing_events").delete().eq("id", event.id);
    return new Response("Processing failed", { status: 500 });
  }

  return Response.json({ received: true });
});
