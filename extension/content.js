function amount(text) {
  const matches = String(text || '').match(/(\d{1,5}(?:[\s.,]\d{1,2})?)\s*€/g) || [];
  if (!matches.length) return null;
  const value = matches[0].replace(/[^\d,.-]/g, '').replace(',', '.');
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function clean(value) { return String(value || '').replace(/\s+/g, ' ').trim(); }

function visibleListings() {
  const links = [...document.querySelectorAll('a[href*="/items/"]')];
  const seen = new Set();
  return links.map(link => {
    const url = new URL(link.href, location.origin);
    const match = url.pathname.match(/\/items\/(\d+)/);
    const id = match?.[1] || url.pathname;
    if (seen.has(id)) return null;
    const card = link.closest('article,[data-testid*="item"],div') || link;
    const text = clean(card.innerText || link.innerText);
    const price = amount(text);
    if (!price) return null;
    const image = card.querySelector('img') || link.querySelector('img');
    const title = clean(image?.alt || link.getAttribute('title') || text.split(/\n| · /)[0] || 'Annonce Vinted');
    seen.add(id);
    return { id, url: url.href, title: title.slice(0, 180), price, image: image?.src || null };
  }).filter(Boolean).slice(0, 100);
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'SCAN_PAGE') sendResponse({ listings: visibleListings(), page: location.href });
});

let lastFingerprint = '', lastSync = 0, timer;
function scheduleAutoSync() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    const listings = visibleListings();
    if (!listings.length || Date.now() - lastSync < 30000) return;
    const fingerprint = listings.map(x => x.id + ':' + x.price).join('|');
    if (fingerprint === lastFingerprint) return;
    chrome.runtime.sendMessage({ type: 'AUTO_SAVE', listings }, response => {
      if (chrome.runtime.lastError || !response?.ok || response.skipped) return;
      lastFingerprint = fingerprint; lastSync = Date.now();
    });
  }, 2500);
}
new MutationObserver(scheduleAutoSync).observe(document.documentElement, { childList: true, subtree: true });
scheduleAutoSync();
