// To add a feature: add a function to `member` (needs club code) or `admin` (needs organizer passcode).
// Each gets (state, body); return extra fields to send back, or nothing. State is saved automatically.
import { load, save } from "./_store.js";
import { THEMES, QUESTIONS } from "./_config.js";
import { emailAll } from "./_email.js";

const pick = (a) => a[Math.floor(Math.random() * a.length)];
const view = (s) => ({ members: s.members.map((m) => m.name), suggestions: s.suggestions, picks: s.picks, theme: s.theme || null });
const fail = (m) => { throw new Error(m); };
const when = (p) => p.when ? new Date(p.when).toLocaleString("en-US", { dateStyle: "full", timeStyle: "short" }) : "";
const announce = (p) => `"${p.title}"${p.movie?.year ? ` (${p.movie.year})` : ""}, suggested by ${p.by}.\nTheme: ${p.theme}${p.when ? `\nWhen: ${when(p)}` : ""}${p.where ? `\nWhere: ${p.where}` : ""}`;

const member = {
  join(s, b) {
    if (!b.name) fail("Name required");
    const m = s.members.find((x) => x.name === b.name);
    if (m) m.email = b.email || m.email; else s.members.push({ name: b.name, email: b.email });
  },
  suggest(s, b) {
    if (!b.name || !b.title) fail("Name and title required");
    s.suggestions[b.name] = { title: b.title, note: b.note || "", picked: false, movie: b.movie || null, seen: [] };
    member.join(s, b);
  },
  seen(s, b) { // toggle "I've seen it" on someone's suggestion
    const v = s.suggestions[b.owner];
    if (!v || !b.name) fail("Enter your name first");
    v.seen = v.seen || [];
    const i = v.seen.indexOf(b.name);
    if (i < 0) v.seen.push(b.name); else v.seen.splice(i, 1);
  },
  rate(s, b) {
    const p = s.picks.find((x) => x.at === b.pick), n = Math.round(+b.score);
    if (!p || !b.name || !(n >= 1 && n <= 10)) fail("Enter your name and a rating from 1 to 10");
    p.ratings = { ...p.ratings, [b.name]: n };
  },
  mylist(s, b) { // a member's private watchlist
    if (!b.name) fail("Enter your name first");
    return { list: (s.watchlists || {})[b.name] || [] };
  },
  watch(s, b) { // add (b.movie) or remove (b.remove + b.id) a watchlist movie
    if (!b.name) fail("Enter your name first");
    s.watchlists = s.watchlists || {};
    let l = s.watchlists[b.name] || [];
    if (b.remove) l = l.filter((m) => m.id !== b.id);
    else if (b.movie && !l.some((m) => m.id === b.movie.id)) l.push(b.movie);
    s.watchlists[b.name] = l;
    return { list: l };
  },
};

const admin = {
  check() {},
  settheme(s, b) {
    const t = String(b.theme || "").trim().slice(0, 120);
    s.theme = t ? { text: t, month: String(b.month || "").trim().slice(0, 30) } : null;
  },
  remove(s, b) { delete s.suggestions[b.name]; },
  clear(s, b) {
    s.suggestions = {};
    if (b.scope === "all") { s.picks = []; s.members = []; s.theme = null; }
  },
  async details(s, b) { // set watch date/place on the latest pick and email everyone
    const p = s.picks[0];
    if (!p) fail("Draw a movie first");
    p.when = String(b.when || "").slice(0, 16);
    p.where = String(b.where || "").slice(0, 120);
    return { emailed: await emailAll(s.members, `Movie club: ${p.title}`, `Details are set!\n\n${announce(p)}`) };
  },
  async draw(s) {
    const pool = Object.entries(s.suggestions).filter(([, v]) => !v.picked);
    if (!pool.length) fail("Nothing left in the pool");
    // Fair draw: people who haven't won in a while get better odds; movies many members have seen get worse odds.
    const last = {};
    s.picks.forEach((p, i) => { if (!(p.by in last)) last[p.by] = i; });
    const w = pool.map(([by, v]) => (1 + (last[by] ?? s.picks.length)) / (1 + (v.seen || []).length));
    let r = Math.random() * w.reduce((a, b) => a + b, 0), i = 0;
    for (; i < pool.length - 1; i++) { r -= w[i]; if (r <= 0) break; }
    const [by, v] = pool[i];
    v.picked = true;
    const qs = [...QUESTIONS].sort(() => Math.random() - 0.5).slice(0, 3);
    const p = { at: Date.now(), title: v.title, by, note: v.note, movie: v.movie, theme: s.theme?.text || pick(THEMES), questions: qs, ratings: {} };
    s.picks.unshift(p);
    return { latest: { ...p, emailed: await emailAll(s.members, `Movie club pick: ${p.title}`, `This round's movie:\n${announce(p)}\n\nFind a time to watch it!`) } };
  },
};

export default async function handler(req, res) {
  const s = await load();
  if (req.method === "GET") return res.json(view(s));
  const b = req.body || {};
  const isAdmin = Object.hasOwn(admin, b.action), fn = isAdmin ? admin[b.action] : member[b.action];
  if (!fn) return res.status(400).json({ error: "Unknown action" });
  if (isAdmin) {
    if (!process.env.ADMIN_KEY || b.adminKey !== process.env.ADMIN_KEY) return res.status(403).json({ error: "Wrong organizer passcode" });
  } else if (b.code !== process.env.CLUB_CODE) return res.status(401).json({ error: "Wrong club code" });
  try {
    const extra = (await fn(s, b)) || {};
    await save(s);
    res.json({ ...view(s), ...extra });
  } catch (e) { res.status(400).json({ error: e.message }); }
}
