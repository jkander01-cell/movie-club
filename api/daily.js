// Fresh questions, generated on demand and cached so every player sees the same ones.
//   Candidates: TMDB (popularity decides Easy vs Hard).
//   Locations: Wikidata "filming location" with coordinates (only used when all listed locations agree).
//   Clue writing: Claude (needs ANTHROPIC_API_KEY). Anything that fails validation is skipped.
// Needs: TMDB_API_KEY, Upstash (KV_REST_API_* or UPSTASH_REDIS_REST_*), and either GEMINI_API_KEY (free) or ANTHROPIC_API_KEY.
// If any piece is missing this returns {off:true} and the page keeps using its built-in questions.
const EPOCH = Date.UTC(2026, 10, 3);
const RURL = () => process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const RTOK = () => process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const MODEL = () => process.env.CLAUDE_MODEL || "claude-sonnet-5-5";
const GEN_SLOTS = 2;

async function redis(cmds) {
  const r = await fetch(`${RURL()}/pipeline`, { method: "POST", headers: { Authorization: `Bearer ${RTOK()}`, "Content-Type": "application/json" }, body: JSON.stringify(cmds) });
  if (!r.ok) throw new Error("redis " + r.status);
  return (await r.json()).map((x) => { if (x.error) throw new Error(x.error); return x.result; });
}
const tmdb = async (path) => { const r = await fetch(`https://api.themoviedb.org/3${path}`, { headers: { Authorization: `Bearer ${process.env.TMDB_API_KEY}` } }); if (!r.ok) throw new Error("tmdb " + r.status); return r.json(); };

function haversine(a, b) {
  const R = 6371, rad = Math.PI / 180, dLat = (b[1] - a[1]) * rad, dLon = (b[0] - a[0]) * rad;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

async function filmingLocation(tmdbId) {
  const q = `SELECT ?locLabel ?coord WHERE { ?f wdt:P4947 "${tmdbId}". ?f wdt:P915 ?loc. ?loc wdt:P625 ?coord. SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } } LIMIT 8`;
  const r = await fetch(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(q)}`, { headers: { Accept: "application/sparql-results+json", "User-Agent": "LocationScout/1.0 (daily movie trivia game)" } });
  if (!r.ok) return null;
  const rows = ((await r.json()).results || {}).bindings || [];
  const pts = rows.map((b) => { const m = /Point\(([-\d.]+) ([-\d.]+)\)/.exec(b.coord.value); return m ? { label: b.locLabel.value, lon: +m[1], lat: +m[2] } : null; }).filter(Boolean);
  if (!pts.length) return null;
  if (pts.some((p) => haversine([pts[0].lon, pts[0].lat], [p.lon, p.lat]) > 150)) return null; // ambiguous: skip
  if (/^Q\d+$/.test(pts[0].label)) return null;
  return pts[0];
}

const words = (s) => String(s).toLowerCase().replace(/[^a-z0-9À-ɏ ]/g, " ").split(/\s+/).filter((w) => w.length >= 4);
const STOP = new Set(["the", "and", "with", "from", "that", "this", "into", "city", "town", "state", "film", "movie", "love", "life", "night", "story", "dead", "day", "days", "man", "men", "king", "last", "first", "new"]);

async function writeClue(m, loc, diff) {
  const prompt = `You write clues for a daily geography trivia game where players tap a globe to find where a movie was filmed.

Movie: ${m.title} (${m.year}), directed by ${m.director || "unknown"}.
Plot summary (may contain spoilers and place names; do not copy place names): ${m.overview}
Filming location (Wikidata): ${loc.label} at latitude ${loc.lat}, longitude ${loc.lon}.

Write ONE clue, 1-2 sentences, 25-55 words, for ${diff === "h" ? "HARD" : "EASY"} difficulty.
Rules:
- Never include the movie title, the location name, the country, state, or the names of any city, region, mountain or water body that is within about 300 km of the location.
- Describe a memorable scene, premise or visual from the film, then give 1-2 geographic anchors that are real and fair (for example a larger city it is near, a famous feature, a climate, a historic fact about the place). ${diff === "h" ? "Make the anchors subtle." : "Make the anchors friendly."}
- Only state facts you are certain about. If you are not sure this film was really filmed at that location, or the location is vague, answer {"skip":true}.
- Also write "fact": one short true sentence of trivia about the film or the location (max 25 words). If unsure, use a neutral fact about the film.
- Also write "place": the location as "Name, Country".

Reply with only JSON: {"clue": "...", "fact": "...", "place": "..."} or {"skip": true}.`;
  let text;
  if (process.env.GEMINI_API_KEY) { // free tier: https://aistudio.google.com/apikey
    const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST", headers: { "x-goog-api-key": process.env.GEMINI_API_KEY, "content-type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.3, responseMimeType: "application/json" } }),
    });
    if (!r.ok) throw new Error("gemini " + r.status);
    text = (((await r.json()).candidates || [])[0] || {}).content;
    text = ((text && text.parts) || []).map((p) => p.text || "").join("");
  } else {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL(), max_tokens: 400, messages: [{ role: "user", content: prompt }] }),
    });
    if (!r.ok) throw new Error("claude " + r.status);
    text = ((await r.json()).content || []).map((c) => c.text || "").join("");
  }
  const j = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
  if (j.skip || typeof j.clue !== "string") return null;
  const clue = j.clue.trim(), fact = String(j.fact || "").trim(), place = String(j.place || "").trim();
  if (clue.length < 60 || clue.length > 330 || !fact || fact.length > 220 || !place) return null;
  const low = clue.toLowerCase();
  if (low.includes(m.title.toLowerCase())) return null;
  for (const w of words(m.title)) if (!STOP.has(w) && low.includes(w)) return null;
  for (const w of words(loc.label + " " + place)) if (!STOP.has(w) && low.includes(w)) return null;
  return { clue, fact, place };
}

async function candidate(diff, used, ex) {
  const easy = diff !== "h", page = 1 + Math.floor(Math.random() * (easy ? 12 : 25));
  const range = easy ? "vote_count.gte=7000" : "vote_count.gte=900&vote_count.lte=5500";
  const list = ((await tmdb(`/discover/movie?include_adult=false&sort_by=vote_count.desc&${range}&page=${page}`)).results || []).sort(() => Math.random() - 0.5);
  for (const c of list) {
    if (used.has(String(c.id)) || ex.has((c.title || "").toLowerCase())) continue;
    const loc = await filmingLocation(c.id);
    if (!loc) continue;
    const d = await tmdb(`/movie/${c.id}?append_to_response=credits`);
    const dir = ((d.credits || {}).crew || []).find((p) => p.job === "Director");
    const m = { id: c.id, title: d.title, year: (d.release_date || "").slice(0, 4), director: dir ? dir.name : "", overview: d.overview || "" };
    if (!m.title || !m.year || !m.overview) continue;
    const w = await writeClue(m, loc, diff);
    if (!w) continue;
    return { m, loc, w };
  }
  return null;
}

async function generate(n, diff, ex) {
  const [usedArr] = await redis([["SMEMBERS", `ls:used:${diff}`]]);
  const used = new Set(usedArr || []), out = [];
  for (let tries = 0; tries < 14 && out.length < GEN_SLOTS; tries++) {
    let c = null; try { c = await candidate(diff, used, ex); } catch (e) { continue; }
    if (!c) continue;
    used.add(String(c.m.id));
    out.push([c.w.clue, c.w.place, c.loc.lat, c.loc.lon, c.w.fact, c.m.title, +c.m.year, c.m.director || "Unknown", 1, 0]);
    await redis([["SADD", `ls:used:${diff}`, String(c.m.id)]]);
  }
  return out.length === GEN_SLOTS ? out : null;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!RURL() || !RTOK() || !process.env.TMDB_API_KEY || !(process.env.GEMINI_API_KEY || process.env.ANTHROPIC_API_KEY)) return res.json({ off: true });
  try {
    const nowN = Math.floor((Date.now() - EPOCH) / 864e5) + 1;
    const src = req.method === "POST" ? (typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {}) : req.query || {};
    const cron = req.query && req.query.cron;
    const jobs = cron ? [[nowN, "e"], [nowN, "h"], [nowN + 1, "e"], [nowN + 1, "h"]] : [[parseInt(src.n, 10), src.d === "h" ? "h" : "e"]];
    const ex = new Set((Array.isArray(src.ex) ? src.ex : []).slice(0, 400).map((t) => String(t).toLowerCase()));
    const result = {};
    for (const [n, diff] of jobs) {
      if (!(n >= 1 && n <= nowN + 1)) { if (!cron) return res.status(400).json({ error: "bad request" }); continue; }
      const key = `ls:q:${n}${diff}`;
      let [hit] = await redis([["GET", key]]);
      if (!hit) {
        const [lock] = await redis([["SET", `${key}:lock`, "1", "NX", "EX", 90]]);
        if (!lock) { result[key] = "busy"; if (!cron) return res.json({ off: true, busy: true }); continue; }
        const q = await generate(n, diff, ex);
        if (q) { hit = JSON.stringify(q); await redis([["SET", key, hit, "EX", 60 * 60 * 24 * 365]]); }
        await redis([["DEL", `${key}:lock`]]);
      }
      result[key] = hit ? "ok" : "none";
      if (!cron) return res.json(hit ? { q: JSON.parse(hit) } : { off: true });
    }
    res.json({ cron: true, result });
  } catch (e) { res.json({ off: true }); }
}
