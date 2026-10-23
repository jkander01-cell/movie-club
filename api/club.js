// To add a feature: add a function to `member` (needs club code) or `admin` (needs organizer passcode).
// Each gets (state, body); return extra fields to send back, or nothing. State is saved automatically.
import { load, save } from "./_store.js";
import { THEMES, QUESTIONS, SURVEY, SCHEDULE, MAX_SUGGESTIONS, LIMITED_ODDS, STANDARD_STREAMERS, REGION } from "./_config.js";
import { effective, today, schedule } from "./_schedule.js";
import { sessionUser, setPassword } from "./_auth.js";
import { emailAll } from "./_email.js";
import { stats } from "./_stats.js";

const REACTIONS = ["😂", "😱", "😭", "🤯", "👏", "🍿", "❤️", "😴"];
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const unlocked = (p, u) => !!u && (p.seenBy || []).includes(u) || !!(p.survey || {})[u] || (p.ratings || {})[u] != null;
const shape = (p, u, admin) => { // discussion stays hidden until the member says they've seen the movie (or rated / answered the survey)
  const un = admin || unlocked(p, u), { thread, feed, ...rest } = p;
  return { ...rest, unlocked: un, thread: un ? thread || [] : [], threadN: (thread || []).length, feed: (feed || []).slice(0, 12) };
};
const voteView = (s, u) => s.vote?.open ? { month: s.vote.month || "", options: s.vote.options.map((o, i) => ({ ...o, votes: Object.values(s.vote.votes || {}).filter((x) => x === i).length })), mine: s.vote.votes?.[u] ?? null, total: Object.keys(s.vote.votes || {}).length } : null;
const view = (s, u, admin) => { // members never see draft picks; the organizer sees everything
  const drafts = new Set(s.picks.filter((p) => p.status === "draft").map((p) => p.sid));
  const out = {
    members: s.members.map((m) => m.name),
    suggestions: admin ? s.suggestions : Object.fromEntries(Object.entries(s.suggestions).map(([k, v]) => [k, drafts.has(v.id) ? { ...v, picked: false } : v])),
    picks: (admin ? s.picks : s.picks.filter((p) => p.status !== "draft")).map((p) => shape(p, u, admin)),
    theme: s.theme || null, reactions: REACTIONS, vote: voteView(s, u), survey: SURVEY, maxSuggestions: MAX_SUGGESTIONS, schedule: schedule(s), today: today(), tz: SCHEDULE.timezone,
    me: u ? { name: u, email: s.members.find((m) => m.name === u)?.email || "", used: activeCount(s, u) } : null,
  };
  if (admin) { out.memberInfo = s.members.map((m) => ({ name: m.name, email: !!m.email, address: m.email || "" })); out.themes = THEMES; }
  return out;
};
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
const pickOf = (s, b) => s.picks.find((x) => x.at === b.pick) || fail("Pick not found");
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
    const past = !b.force && s.picks.find((p) => p.status !== "draft" && ((b.movie?.id && p.movie?.id === b.movie.id) || p.title.toLowerCase() === title.toLowerCase()));
    if (past) fail(`ALREADY:The club already picked "${past.title}"${past.when ? ` (${past.when.slice(0, 10)})` : ""}.`);
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
    if (p.movie?.id) { s.myRatings = s.myRatings || {}; (s.myRatings[b.name] = s.myRatings[b.name] || {})[p.movie.id] = { score: n, title: p.title, year: p.movie.year, poster: p.movie.poster, at: Date.now() }; }
  },
  ratemovie(s, b) { // rate ANY movie 1-10 (or b.clear to remove your rating). Also updates the screening's rating if it was a club pick.
    const m = b.movie, n = Math.round(+b.score);
    if (!m?.id) fail("That movie can't be rated");
    s.myRatings = s.myRatings || {};
    const mine = (s.myRatings[b.name] = s.myRatings[b.name] || {});
    if (!b.clear && !(n >= 1 && n <= 10)) fail("Pick a rating from 1 to 10");
    if (b.clear) delete mine[m.id]; else mine[m.id] = { score: n, title: String(m.title || "").slice(0, 100), year: m.year, poster: m.poster, at: Date.now() };
    for (const p of s.picks) if (p.movie?.id === m.id) { p.ratings = p.ratings || {}; if (b.clear) delete p.ratings[b.name]; else p.ratings[b.name] = n; }
  },
  crate(s, b) { // everyone's ratings for one movie
    const id = +b.id, club = {};
    for (const [name, r] of Object.entries(s.myRatings || {})) if (r[id]) club[name] = r[id].score;
    for (const p of s.picks) if (p.movie?.id === id) Object.assign(club, p.ratings || {});
    return { club };
  },
  fav(s, b) { // add (b.movie) or remove (b.remove + b.id) one of a member's 4 favorite films
    s.favorites = s.favorites || {};
    let l = s.favorites[b.name] || [];
    if (b.remove) l = l.filter((m) => m.id !== b.id);
    else if (b.movie && !l.some((m) => m.id === b.movie.id)) { if (l.length >= 4) fail("You can have 4 favorites. Remove one first."); l.push(b.movie); }
    s.favorites[b.name] = l;
    return { favs: s.favorites, ratings: s.myRatings?.[b.name] || {} };
  },
  favs(s, b) { return { favs: s.favorites || {}, ratings: s.myRatings?.[b.name] || {} }; },
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
  rsvp(s, b) { // "live" | "solo" | "no" (or clear)
    const p = s.picks.find((x) => x.at === b.pick && x.status !== "draft") || fail("Pick not found");
    p.rsvp = p.rsvp || {};
    if (!b.answer) delete p.rsvp[b.name];
    else if (["live", "solo", "no"].includes(b.answer)) p.rsvp[b.name] = b.answer;
    else fail("Pick one of the three options");
  },
  seenpick(s, b) { // "I've seen it" unlocks the discussion for that screening
    const p = s.picks.find((x) => x.at === b.pick && x.status !== "draft") || fail("Pick not found");
    p.seenBy = p.seenBy || [];
    const i = p.seenBy.indexOf(b.name);
    if (i < 0) p.seenBy.push(b.name); else if (!(p.survey || {})[b.name] && (p.ratings || {})[b.name] == null) p.seenBy.splice(i, 1);
  },
  post(s, b) { // spoiler-safe discussion: only members who've seen the movie can read or write
    const p = s.picks.find((x) => x.at === b.pick && x.status !== "draft") || fail("Pick not found");
    if (!unlocked(p, b.name)) fail("Mark the movie as seen first.");
    const text = String(b.text || "").trim().slice(0, 600);
    if (!text) fail("Write something first");
    p.thread = p.thread || [];
    if (p.thread.length >= 300) fail("This thread is full");
    p.thread.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), by: b.name, text, at: Date.now() });
  },
  delpost(s, b) {
    const p = s.picks.find((x) => x.at === b.pick) || fail("Pick not found");
    p.thread = (p.thread || []).filter((m) => !(m.id === b.id && m.by === b.name));
  },
  react(s, b) { // quick reactions during the movie
    const p = s.picks.find((x) => x.at === b.pick && x.status !== "draft") || fail("Pick not found");
    if (!REACTIONS.includes(b.emoji)) fail("Unknown reaction");
    p.reacts = p.reacts || {};
    p.reacts[b.emoji] = (p.reacts[b.emoji] || 0) + 1;
    p.feed = [{ by: b.name, e: b.emoji, at: Date.now() }, ...(p.feed || [])].slice(0, 30);
  },
  vote(s, b) { // theme vote for next month
    if (!s.vote?.open) fail("There's no vote open right now");
    const i = Math.round(+b.option);
    if (!(i >= 0 && i < s.vote.options.length)) fail("Pick one of the options");
    s.vote.votes = s.vote.votes || {};
    s.vote.votes[b.name] = i;
  },
  stats(s, b) { return { stats: stats(s, b.year) }; },
  watchedcheck(s, b) { // is this movie something the club already watched?
    const t = String(b.title || "").toLowerCase();
    const p = s.picks.find((x) => x.status !== "draft" && ((b.id && x.movie?.id === b.id) || x.title.toLowerCase() === t));
    return { watched: p ? { title: p.title, when: p.when ? p.when.slice(0, 10) : new Date(p.at).toISOString().slice(0, 10), avg: (() => { const v = Object.values(p.ratings || {}); return v.length ? v.reduce((x, y) => x + y, 0) / v.length : null; })() } : null };
  },
  async recs(s, b) { // movies similar to ones this member (or the club) rated highly
    if (!process.env.TMDB_API_KEY) fail("Movie data isn't set up");
    const mine = Object.entries(s.myRatings?.[b.name] || {}).filter(([, r]) => r.score >= 8).map(([id, r]) => ({ id, title: r.title }));
    const club = s.picks.filter((p) => p.movie?.id && Object.values(p.ratings || {}).length >= 2 && Object.values(p.ratings).reduce((x, y) => x + y, 0) / Object.values(p.ratings).length >= 7.5).map((p) => ({ id: String(p.movie.id), title: p.title }));
    const seeds = (mine.length ? mine : club).sort(() => Math.random() - 0.5).slice(0, 4);
    if (!seeds.length) return { recs: [], note: "Rate a few movies 8 or higher and we'll find more like them." };
    const skip = new Set([...s.picks.filter((p) => p.status !== "draft").map((p) => p.movie?.id), ...Object.values(s.suggestions).filter((v) => !v.picked).map((v) => v.movie?.id), ...Object.keys(s.myRatings?.[b.name] || {}).map(Number)].filter(Boolean));
    const got = {};
    await Promise.all(seeds.map(async (sd) => {
      try {
        const r = await fetch(`https://api.themoviedb.org/3/movie/${sd.id}/recommendations`, { headers: { Authorization: `Bearer ${process.env.TMDB_API_KEY}` } });
        if (!r.ok) return;
        for (const m of (await r.json()).results || []) if (!skip.has(m.id) && m.poster_path && !got[m.id]) got[m.id] = { id: m.id, title: m.title, year: (m.release_date || "").slice(0, 4), poster: `https://image.tmdb.org/t/p/w185${m.poster_path}`, overview: (m.overview || "").slice(0, 280), because: sd.title, score: m.vote_average || 0 };
      } catch (e) { /* skip this seed */ }
    }));
    return { recs: Object.values(got).sort((a, b) => b.score - a.score).slice(0, 10) };
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
  async openvote(s, b) { // let members vote on next month's theme
    const o = (Array.isArray(b.options) ? b.options : []).map((x) => ({ text: String(x.text || "").trim().slice(0, 120), desc: String(x.desc || "").trim().slice(0, 200) })).filter((x) => x.text).slice(0, 6);
    if (o.length < 2) fail("Add at least two options");
    s.vote = { open: true, month: String(b.month || "").trim().slice(0, 30), options: o, votes: {}, at: Date.now() };
    if (b.email) { const r = await emailAll(s.members, "Vote for the next theme", `Help pick the next movie club theme:\n${o.map((x) => "- " + x.text).join("\n")}\n\nVote here: https://majordudemedia.com`); if (!r.ok) return { emailError: r.error }; return { emailed: r.count }; }
  },
  closevote(s, b) { // the winner becomes the theme (ties go to the earlier option)
    if (!s.vote?.open) fail("No vote is open");
    const n = s.vote.options.map((_, i) => Object.values(s.vote.votes || {}).filter((x) => x === i).length), top = n.indexOf(Math.max(...n));
    if (b.apply !== false) { const w = s.vote.options[top]; s.theme = { text: w.text, desc: w.desc, month: s.vote.month }; }
    s.vote = null;
  },
  settheme(s, b) {
    const t = String(b.theme || "").trim().slice(0, 120);
    s.theme = t ? { text: t, desc: String(b.desc || "").trim().slice(0, 200), month: String(b.month || "").trim().slice(0, 30) } : null;
  },
  remove(s, b) { delete s.suggestions[b.name]; },
  clear(s, b) {
    s.suggestions = {};
    if (b.scope === "all") { s.picks = []; s.members = []; s.theme = null; }
  },
  details(s, b) { // save date/place on a pick (no email)
    const p = b.pick ? pickOf(s, b) : s.picks[0] || fail("Draw a movie first");
    p.when = String(b.when || "").slice(0, 16);
    p.where = String(b.where || "").slice(0, 120);
  },
  publish(s, b) { const p = pickOf(s, b); p.status = "published"; p.publishedAt = Date.now(); },
  async notify(s, b) { // email a published pick. b.to = member names to include (default: everyone), b.extra = other addresses
    const p = pickOf(s, b);
    if (p.status === "draft") fail("Publish it first so people can see it on the site.");
    const want = Array.isArray(b.to) ? new Set(b.to) : null;
    const people = s.members.filter((m) => !want || want.has(m.name));
    const extra = (Array.isArray(b.extra) ? b.extra : []).map((x) => String(x).trim()).filter((x) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x)).slice(0, 30).map((email) => ({ email }));
    const r = await emailAll([...people, ...extra], `Movie club pick: ${p.title}`, `This round's movie:\n${announce(p)}${PLAN}`);
    if (!r.ok) fail(r.error);
    p.notifiedAt = Date.now();
    return { sent: r.count };
  },
  discard(s, b) { // undo a pick: the movie goes back into the pool
    const p = pickOf(s, b), v = s.suggestions[p.sid] || Object.values(s.suggestions).find((x) => x.picked && x.by === p.by && x.title === p.title);
    if (v) v.picked = false;
    s.picks.splice(s.picks.indexOf(p), 1);
  },
  async draw(s, o) { // creates a DRAFT: nothing is shown to members or emailed until you publish / announce. o.id picks a specific movie.
    if (s.picks.some((x) => x.status === "draft")) fail("You already have a draft pick. Publish it or undo it before drawing again.");
    const pool = Object.values(s.suggestions).filter((v) => !v.picked);
    if (!pool.length) fail("Nothing left in the pool");
    let v;
    if (o.id) { v = s.suggestions[o.id]; if (!v || v.picked) fail("That movie isn't in the pool"); }
    else {
      // Fair draw: people who haven't won in a while get better odds; movies many members have seen or that are hard to stream get worse odds.
      const last = {};
      s.picks.forEach((p, i) => { if (!(p.by in last)) last[p.by] = i; });
      const cnt = {};
      pool.forEach((x) => { cnt[x.by] = (cnt[x.by] || 0) + 1; }); // each member gets the same total chance, however many movies they entered
      const w = pool.map((x) => (1 + (last[x.by] ?? s.picks.length)) / cnt[x.by] / (1 + (x.seen || []).length) * (x.limited ? LIMITED_ODDS : 1));
      let r = Math.random() * w.reduce((x, y) => x + y, 0), i = 0;
      for (; i < pool.length - 1; i++) { r -= w[i]; if (r <= 0) break; }
      v = pool[i];
    }
    v.picked = true;
    const qs = [...QUESTIONS].sort(() => Math.random() - 0.5).slice(0, 3);
    const p = { at: Date.now(), sid: v.id, status: "draft", title: v.title, by: v.by, note: v.note, movie: v.movie, theme: s.theme?.text || pick(THEMES), themeDesc: s.theme?.desc || "", questions: qs, ratings: {} };
    if (v.movie?.id) for (const [name, r] of Object.entries(s.myRatings || {})) if (r[v.movie.id]) p.ratings[name] = r[v.movie.id].score; // carry over ratings members already gave this movie
    // Assign the draw to the next screening date that has no pick yet
    const taken = new Set(s.picks.map((x) => x.when?.slice(0, 10)));
    const date = effective(s, 8).find((d) => !taken.has(d));
    if (date) p.when = `${date}T${SCHEDULE.time}`;
    s.picks.unshift(p);
    return { latest: p };
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
    res.json({ ...view(s, user, isAdmin), ...extra });
  } catch (e) { res.status(400).json({ error: e.message }); }
}
