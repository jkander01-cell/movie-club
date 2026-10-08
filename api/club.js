import { Redis } from "@upstash/redis";
const redis = new Redis({
  url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
});
const THEMES = ["Dress as a character","Themed snacks only","Predict the ending before we start","Rate it 1-10 before and after discussion","Hot take night: one unpopular opinion each","Watch with subtitles on","Bring a snack from the movie's country","Cast the sequel: who would you hire?"];
const pick = (a) => a[Math.floor(Math.random() * a.length)];

async function emailAll(members, p) {
  const to = members.map((m) => m.email).filter(Boolean);
  if (!to.length || !process.env.RESEND_API_KEY) return false;
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.FROM_EMAIL, to,
      subject: `Movie club pick: ${p.title}`,
      text: `This round's movie: "${p.title}" ${p.movie?.year ? `(${p.movie.year}) ` : ""}(suggested by ${p.by}).\nTheme: ${p.theme}\n\nFind a time to watch it!`,
    }),
  });
  return r.ok;
}

export default async function handler(req, res) {
  const s = (await redis.get("club")) || { members: [], suggestions: {}, picks: [] };
  const pub = () => ({ members: s.members.map((m) => m.name), suggestions: s.suggestions, picks: s.picks });
  if (req.method === "GET") return res.json(pub());

  const { action, code, name, email, title, note, movie, adminKey } = req.body || {};
  if (code !== process.env.CLUB_CODE) return res.status(401).json({ error: "Wrong club code" });
  const save = () => redis.set("club", s);

  if (action === "join") {
    if (!name) return res.status(400).json({ error: "Name required" });
    const m = s.members.find((x) => x.name === name);
    if (m) m.email = email || m.email; else s.members.push({ name, email });
    await save();
  } else if (action === "suggest") {
    if (!name || !title) return res.status(400).json({ error: "Name and title required" });
    s.suggestions[name] = { title, note: note || "", picked: false, movie: movie || null };
    if (!s.members.find((x) => x.name === name)) s.members.push({ name, email });
    await save();
  } else if (action === "draw") {
    if (adminKey !== process.env.ADMIN_KEY) return res.status(403).json({ error: "Organizer only" });
    const pool = Object.entries(s.suggestions).filter(([, v]) => !v.picked);
    if (!pool.length) return res.status(400).json({ error: "Nothing left in the pool" });
    const [by, v] = pick(pool);
    v.picked = true;
    const p = { title: v.title, by, theme: pick(THEMES), at: Date.now(), movie: v.movie || null };
    s.picks.unshift(p);
    await save();
    p.emailed = await emailAll(s.members, p);
    return res.json({ ...pub(), latest: p });
  }
  res.json(pub());
}
