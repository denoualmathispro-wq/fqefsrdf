import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("redirects the root page to the ResellGO landing page", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  const response = await worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );

  assert.equal(response.status, 307);
  assert.equal(response.headers.get("location"), "http://localhost/resellgo.html");
});

test("renders the paid advanced dashboard from real account data", async () => {
  const app = await readFile(new URL("../public/app.html", import.meta.url), "utf8");

  assert.match(app, /function paidAccess\(\)/);
  assert.match(app, /function analysisMargin\(x\)/);
  assert.match(app, /Performance nette sur 7 jours/);
  assert.match(app, /Potentiel par catégorie/);
  assert.match(app, /État du catalogue/);
  assert.match(app, /function refreshBillingAccess\(attempt=0\)/);
  assert.doesNotMatch(app, /Number\(x\.margin\|\|0\)/);
});

test("includes the authorized profitability radar flow", async () => {
  const app = await readFile(new URL("../public/app.html", import.meta.url), "utf8");

  assert.match(app, /Radar rentabilité/);
  assert.match(app, /function renderRadar\(c\)/);
  assert.match(app, /function saveOpportunity\(e\)/);
  assert.match(app, /function importRadarCsv\(\)/);
  assert.match(app, /function promoteOpportunity\(id\)/);
  assert.match(app, /Sources autorisées uniquement/);
  assert.doesNotMatch(app, /vinted.*password|password.*vinted/i);
});

test("includes secure scheduled Vinted provider synchronization", async () => {
  const app = await readFile(new URL("../public/app.html", import.meta.url), "utf8");
  const edge = await readFile(new URL("../supabase/functions/market-sync/index.ts", import.meta.url), "utf8");
  const migration = await readFile(new URL("../supabase/migrations/20260911015849_add_market_sync_automation.sql", import.meta.url), "utf8");

  assert.match(app, /function saveSyncSource\(e\)/);
  assert.match(app, /function runMarketSync\(sourceId\)/);
  assert.match(app, /même lorsque ton navigateur est fermé/);
  assert.match(edge, /Deno\.env\.get\("BRIGHTDATA_API_TOKEN"\)/);
  assert.match(edge, /validate_market_sync_cron_token/);
  assert.match(edge, /datasets\/v3\/snapshot/);
  assert.match(migration, /cron\.schedule/);
  assert.match(migration, /enable row level security/);
  assert.doesNotMatch(app, /BRIGHTDATA_API_TOKEN\s*=/);
});
