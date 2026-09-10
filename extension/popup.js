const $ = id => document.getElementById(id);
function status(text, type = '') { const el = $('status'); el.textContent = text; el.className = `status ${type}`; }
function mode(email) { $('login').classList.toggle('hide', !!email); $('scanner').classList.toggle('hide', !email); $('account').textContent = email ? `Connecté : ${email}` : ''; }

chrome.runtime.sendMessage({ type: 'STATUS' }, response => mode(response?.email));
$('connect').onclick = () => {
  status('Connexion…');
  chrome.runtime.sendMessage({ type: 'LOGIN', email: $('email').value.trim(), password: $('password').value }, response => {
    if (!response?.ok) return status(response?.error || 'Connexion impossible.', 'err');
    $('password').value = ''; mode(response.session.user.email); status('Compte ResellGO connecté.', 'ok');
  });
};
$('logout').onclick = () => chrome.runtime.sendMessage({ type: 'LOGOUT' }, () => { mode(null); status('Déconnecté.'); });
$('scan').onclick = async () => {
  status('Lecture des annonces visibles…');
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url?.includes('vinted.')) return status('Ouvre d’abord une page de recherche Vinted.', 'err');
  chrome.tabs.sendMessage(tab.id, { type: 'SCAN_PAGE' }, scan => {
    if (chrome.runtime.lastError) return status('Recharge la page Vinted puis réessaie.', 'err');
    const listings = scan?.listings || [];
    if (!listings.length) return status('Aucune carte d’annonce visible détectée.', 'err');
    chrome.runtime.sendMessage({ type: 'SAVE', listings, multiplier: Number($('multiplier').value || 1.35) }, saved => {
      if (!saved?.ok) return status(saved?.error || 'Import impossible.', 'err');
      status(`${saved.rows.length} annonce(s) synchronisée(s) dans le Radar.`, 'ok');
    });
  });
};
