// To add a feature: add a function to `member` (needs club code) or `admin` (needs organizer passcode).
// Each gets (state, body); return extra fields to send back, or nothing. State is saved automatically.
import { load, save } from "./_store.js";
import { THEMES, QUESTIONS, SURVEY, SCHEDULE, MAX_SUGGESTIONS, LIMITED_ODDS, STANDARD_STREAMERS, REGION } from "./_config.js";
import { effective, today, schedule } from "./_schedule.js";
import { sessionUser, setPassword } from "./_auth.js";
import { emailAll } from "./_email.js";

const pick = (a) => a[Math.floor(Math.random() * a.length)];
const view = (s, u) => ({ members: s.members.map((m) => m.name), suggestions: s.suggestions, picks: s.picks, theme: s.theme || null, survey: SURVEY, maxSuggestions: MAX_SUGGESTIONS, schedule: schedule(s), me: u ? { name: u, email: s.members.find((m) => m.name === u)?.email || "", used: activeCount(s, u) } : null });
// A suggestion slot is used until the movie has been WATCHED (its screening date has passed), not just picked.
const watched = (s, v) => {
  const p = s.picks.find((x) => x.sid === v.id) || s.picks.find((x) => x.by === v.by && x.title === v.title);
  if (!p) return false;
  return p.when ? p.when.slice(0, 10) < today() : Date.now() - p.at > 7 * 864e5;
};
const activeCount = (s, name) => Object.values(s.suggestions).filter((v) => v.by === name && (!v.picked || !watched(s, v))).length;
async function limitedStreaming(id) { // true when TMDB lists no standard subscription streamer for the movie
  if (!id || !process.env.TMDB_API_KEY) return false;
  try {
    const r = await fetch(`https://api.themoviedb.org/3/movie/${id}/watch/providers`, { headers: { Authorization: `Bearer ${process.env.TMDB_API_KEY}` } });
    if (!r.ok) return false;
    const us = (await r.json()).results?.[REGION] || {};
    return !(us.flatrate || []).some((x) => STANDARD_STREAMERS.test(x.provider_name));
  } catch (e) { return false; }
}
const fail = (m) => { throw new Error(m); };
const when = (p) => p.when ? new Date(p.when).toLocaleString("en-US", { dateStyle: "full", timeStyle: "short" }) : "";
const PLAN = "\n\nWe watch together at the same time. Can't make it? Watch on your own beforehand and fill out the survey on the site before we discuss.";
const announce = (p) => `"${p.title}"${p.movie?.year ? ` (${p.movie.year})` : ""}, suggested by ${p.by}.\nTheme: ${p.theme}${p.themeDesc ? ` (${p.themeDesc})` : ""}${p.when ? `\nWhen: ${when(p)}` : ""}${p.where ? `\nWhere: ${p.where}` : ""}`;

const member = {
  join(s, b) {
    if (!b.name) fail("Name required");
    const m = s.members.find((x) => x.name === b.name);
    if (m) m.email = b.email || m.email; else s.members.push({ name: b.name, email: b.email });
  },
  async suggest(s, b) { // each member holds MAX_SUGGESTIONS slots; a slot frees up once their movie has been watched
    if (!b.name || !b.title) fail("Name and title required");
    const title = String(b.title).trim().slice(0, 100), open = Object.values(s.suggestions).filter((v) => !v.picked);
    const dup = open.find((v) => (b.movie?.id && v.movie?.id === b.movie.id) || v.title.toLowerCase() === title.toLowerCase());
    if (dup) fail(`"${dup.title}" is already in the pool (suggested by ${dup.by}).`);
    if (activeCount(s, b.name) >= MAX_SUGGESTIONS) {
      const old = b.replace && s.suggestions[b.replace];
      if (!old || old.by !== b.name || old.picked) fail(open.some((v) => v.by === b.name) ? `You can have ${MAX_SUGGESTIONS} suggestions at a time. Choose one to replace.` : `Your ${MAX_SUGGESTIONS} suggestions are lined up to be watched. You can add another once one has been watched.`);
      delete s.suggestions[b.replace];
    }
    const limited = await limitedStreaming(b.movie?.id);
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    s.suggestions[id] = { id, by: b.name, title, note: b.note || "", picked: false, movie: b.movie || null, seen: [], hearts: [], limited };
    member.join(s, b);
  },
  unsuggest(s, b) {
    const v = s.suggestions[b.id];
    if (!v || v.by !== b.name || v.picked) fail("Can't remove that one");
    delete s.suggestions[b.id];
  },
  heart(s, b) { // toggle a heart on someone's suggestion
    const v = s.suggestions[b.owner];
    if (!v) fail("Movie not found");
    v.hearts = v.hearts || [];
    const i = v.hearts.indexOf(b.name);
    if (i < 0) v.hearts.push(b.name); else v.hearts.splice(i, 1);
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
  survey(s, b) { // after-the-credits answers for a pick
    const p = s.picks.find((x) => x.at === b.pick);
    if (!p) fail("Pick not found");
    const out = {};
    for (const q of SURVEY) {
      let v = b.answers?.[q.id];
      if (v == null) continue;
      if (q.type === "yn" && !["yes", "no"].includes(v)) continue;
      if (q.type === "choice" && !q.options.includes(v)) continue;
      if (q.type === "text") v = String(v).trim().slice(0, 400);
      if (v) out[q.id] = v;
    }
    if (!Object.keys(out).length) fail("Answer at least one question");
    p.survey = { ...p.survey, [b.name]: out };
  },
  lists(s) { return { lists: s.watchlists || {} }; }, // everyone's watchlists (members only)
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
  setschedule(s, b) { // skip regular dates and/or add one-off ones
    const ok = (a) => (Array.isArray(a) ? a : []).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).slice(0, 40);
    s.sched = { skip: ok(b.skip), extra: ok(b.extra) };
  },
  recipe(s, b) { // pairing recipe for a pick (default: latest)
    const p = s.picks.find((x) => x.at === b.pick) || s.picks[0];
    if (!p) fail("Draw a movie first");
    p.recipe = b.title || b.text ? { title: String(b.title || "").slice(0, 100), text: String(b.text || "").slice(0, 3000) } : null;
  },
  async resetpw(s, b) { await setPassword(b.username, b.password); },
  settheme(s, b) {
    const t = String(b.theme || "").trim().slice(0, 120);
    s.theme = t ? { text: t, desc: String(b.desc || "").trim().slice(0, 200), month: String(b.month || "").trim().slice(0, 30) } : null;
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
    return { emailed: await emailAll(s.members, `Movie club: ${p.title}`, `Details are set!\n\n${announce(p)}${PLAN}`) };
  },
  async draw(s) {
    const pool = Object.values(s.suggestions).filter((v) => !v.picked);
    if (!pool.length) fail("Nothing left in the pool");
    // Fair draw: people who haven't won in a while get better odds; movies many members have seen get worse odds.
    const last = {};
    s.picks.forEach((p, i) => { if (!(p.by in last)) last[p.by] = i; });
    const cnt = {};
    pool.forEach((v) => { cnt[v.by] = (cnt[v.by] || 0) + 1; }); // each member gets the same total chance, however many movies they entered
    const w = pool.map((v) => (1 + (last[v.by] ?? s.picks.length)) / cnt[v.by] / (1 + (v.seen || []).length) * (v.limited ? LIMITED_ODDS : 1));
    let r = Math.random() * w.reduce((a, b) => a + b, 0), i = 0;
    for (; i < pool.length - 1; i++) { r -= w[i]; if (r <= 0) break; }
    const v = pool[i], by = v.by;
    v.picked = true;
    const qs = [...QUESTIONS].sort(() => Math.random() - 0.5).slice(0, 3);
    const p = { at: Date.now(), sid: v.id, title: v.title, by, note: v.note, movie: v.movie, theme: s.theme?.text || pick(THEMES), themeDesc: s.theme?.desc || "", questions: qs, ratings: {} };
    // Assign the draw to the next screening date that has no pick yet
    const taken = new Set(s.picks.map((x) => x.when?.slice(0, 10)));
    const date = effective(s, 8).find((d) => !taken.has(d));
    if (date) p.when = `${date}T${SCHEDULE.time}`;
    s.picks.unshift(p);
    return { latest: { ...p, emailed: await emailAll(s.members, `Movie club pick: ${p.title}`, `This round's movie:\n${announce(p)}${PLAN}`) } };
  },
};

export default async function handler(req, res) {
  const s = await load(), user = await sessionUser(req);
  if (req.method === "GET") return user ? res.json(view(s, user)) : res.status(401).json({ error: "Please log in" });
  const b = req.body || {};
  const isAdmin = Object.hasOwn(admin, b.action), fn = isAdmin ? admin[b.action] : member[b.action];
  if (!fn) return res.status(400).json({ error: "Unknown action" });
  if (isAdmin) {
    if (!process.env.ADMIN_KEY || b.adminKey !== process.env.ADMIN_KEY) return res.status(403).json({ error: "Wrong organizer passcode" });
  } else if (!user) return res.status(401).json({ error: "Please log in" });
  else b.name = user; // members always act as themselves
  try {
    const extra = (await fn(s, b)) || {};
    await save(s);
    res.json({ ...view(s, user), ...extra });
  } catch (e) { res.status(400).json({ error: e.message }); }
}
