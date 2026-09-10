const SUPABASE_URL = 'https://uydivhuoajbnmjjfpeyg.supabase.co';
const SUPABASE_KEY = 'sb_publishable_K1z4eAdM8WXODNYo40lK6w_O4HNkWle';

async function request(path, options = {}) {
  const response = await fetch(SUPABASE_URL + path, {
    ...options,
    headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.msg || body?.message || body?.error_description || `Erreur ${response.status}`);
  return body;
}

async function signIn(email, password) {
  const session = await request('/auth/v1/token?grant_type=password', {
    method: 'POST', body: JSON.stringify({ email, password })
  });
  await chrome.storage.local.set({ session, autoSync: true, multiplier: 1.35 });
  return session;
}

async function validSession() {
  let { session } = await chrome.storage.local.get('session');
  if (!session) throw new Error('Connecte d’abord ton compte ResellGO.');
  if (Date.now() < (session.expires_at - 60) * 1000) return session;
  session = await request('/auth/v1/token?grant_type=refresh_token', {
    method: 'POST', body: JSON.stringify({ refresh_token: session.refresh_token })
  });
  await chrome.storage.local.set({ session });
  return session;
}

async function saveListings(listings, multiplier) {
  const session = await validSession();
  const userId = session.user?.id;
  if (!userId) throw new Error('Session ResellGO invalide.');
  const rows = listings.slice(0, 100).map(item => ({
    user_id: userId,
    source: 'authorized_api',
    external_id: item.id || item.url,
    external_url: item.url,
    title: String(item.title || 'Annonce Vinted').slice(0, 180),
    brand: item.brand || null,
    category: item.category || 'Vinted',
    size: item.size || null,
    item_condition: item.condition || null,
    buy_price: item.price,
    buyer_fee: 0,
    shipping: 0,
    estimated_resale: Number((item.price * multiplier).toFixed(2)),
    seller_fee: 0,
    confidence_score: 45,
    demand_score: 50,
    observed_at: new Date().toISOString()
  }));
  if (!rows.length) throw new Error('Aucune annonce visible détectée sur cette page.');
  return request('/rest/v1/market_opportunities?on_conflict=user_id,source,external_id', {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.access_token}`, Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify(rows)
  });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    if (message.type === 'LOGIN') return { ok: true, session: await signIn(message.email, message.password) };
    if (message.type === 'STATUS') {
      const { session, autoSync = true, multiplier = 1.35 } = await chrome.storage.local.get(['session','autoSync','multiplier']);
      return { ok: true, email: session?.user?.email || null, autoSync, multiplier };
    }
    if (message.type === 'SETTINGS') { await chrome.storage.local.set({ autoSync: !!message.autoSync, multiplier: message.multiplier }); return { ok: true }; }
    if (message.type === 'AUTO_SAVE') { const { autoSync = true, multiplier = 1.35 } = await chrome.storage.local.get(['autoSync','multiplier']); if (!autoSync) return { ok: true, skipped: true }; return { ok: true, rows: await saveListings(message.listings, multiplier) }; }
    if (message.type === 'LOGOUT') { await chrome.storage.local.remove('session'); return { ok: true }; }
    if (message.type === 'SAVE') return { ok: true, rows: await saveListings(message.listings, message.multiplier) };
    throw new Error('Action inconnue.');
  })().then(sendResponse).catch(error => sendResponse({ ok: false, error: error.message }));
  return true;
});
