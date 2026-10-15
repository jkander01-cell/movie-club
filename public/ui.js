// Shared helpers for index.html and admin.html
const $ = (i) => document.getElementById(i);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const img = (m, c) => (m && m.poster ? `<img class="${c || ''}" src="${esc(m.poster)}" alt="">` : '');
const store = (k, v) => { try { if (v === undefined) return localStorage.getItem(k) || ''; localStorage.setItem(k, v); } catch (e) { return ''; } };
const avg = (p) => { const v = Object.values(p.ratings || {}); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
const authFetch = (u, o = {}) => fetch(u, { ...o, headers: { 'Content-Type': 'application/json', ...(o.headers || {}), Authorization: 'Bearer ' + store('tok') } });
function toast(msg) {
  let t = $('toast'); if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
  t.textContent = msg; t.classList.add('on'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('on'), 3500);
}
async function api(body, quiet) {
  const r = await authFetch('/api/club', { method: 'POST', body: JSON.stringify(body) });
  const d = await r.json();
  if (r.status === 401 && typeof showAuth === 'function') { showAuth(); return null; }
  if (!r.ok) { if (!quiet) toast(d.error); return null; }
  return d;
}
const gcal = (p) => {
  const s = p.when.replace(/[-:]/g, '') + '00', h = (+p.when.slice(11, 13) + 2) % 24;
  const e = p.when.slice(0, 11).replace(/-/g, '') + String(h).padStart(2, '0') + p.when.slice(14) + '00';
  return 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=' + encodeURIComponent('Movie club: ' + p.title) + '&dates=' + s + '/' + e + '&location=' + encodeURIComponent(p.where || '');
};
