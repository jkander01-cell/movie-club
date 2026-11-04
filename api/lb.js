// Anonymous daily leaderboard. Uses the same Upstash Redis your other project uses
// (env: KV_REST_API_URL / KV_REST_API_TOKEN or UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN).
// If Redis isn't configured this returns {off:true} and the page simply hides the leaderboard.
const URL_ = () => process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = () => process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const EPOCH = Date.UTC(2026, 10, 3);
const TTL = 60 * 60 * 24 * 90;

async function pipe(cmds) {
  const r = await fetch(`${URL_()}/pipeline`, { method: "POST", headers: { Authorization: `Bearer ${TOKEN()}`, "Content-Type": "application/json" }, body: JSON.stringify(cmds) });
  if (!r.ok) throw new Error("redis " + r.status);
  return (await r.json()).map((x) => { if (x.error) throw new Error(x.error); return x.result; });
}

async function board(n, id, d) {
  const zk = `ls:z:${n}${d}`, hk = `ls:h:${n}${d}`;
  const [flat, rank, count] = await pipe([["ZREVRANGE", zk, 0, 9, "WITHSCORES"], ["ZREVRANK", zk, id], ["ZCARD", zk]]);
  const ids = [], scores = [];
  for (let i = 0; i < flat.length; i += 2) { ids.push(flat[i]); scores.push(+flat[i + 1]); }
  const meta = ids.length ? (await pipe([["HMGET", hk, ...ids]]))[0] : [];
  const top = ids.map((x, i) => { let m = {}; try { m = JSON.parse(meta[i]); } catch (e) {} return { name: m.n || "Anon", t: scores[i], s: m.s || "", me: x === id }; });
  let me = null;
  if (rank !== null && rank !== undefined) { const [raw, sc] = await pipe([["HGET", hk, id], ["ZSCORE", zk, id]]); let m = {}; try { m = JSON.parse(raw); } catch (e) {} me = { rank: rank + 1, name: m.n || "", t: +sc, s: m.s || "" }; }
  return { top, me, count };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!URL_() || !TOKEN()) return res.json({ off: true });
  try {
    const src = req.method === "POST" ? (typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {}) : req.query || {};
    const n = parseInt(src.n, 10), id = String(src.id || ""), d = src.d === "h" ? "h" : "e";
    const nowN = Math.floor((Date.now() - EPOCH) / 864e5) + 1;
    if (!(n >= 1 && n <= nowN + 1 && n >= nowN - 1) || !/^[a-z0-9-]{8,40}$/.test(id)) return res.status(400).json({ error: "bad request" });
    if (req.method === "POST") {
      const t = parseInt(src.t, 10), s = String(src.s || "");
      const name = String(src.name || "").replace(/[\u0000-\u001f<>&"'`\\]/g, "").replace(/\s+/g, " ").trim().slice(0, 16);
      if (!(t >= 0 && t <= 5000) || !/^[gyor]{5}$/.test(s) || name.length < 2) return res.status(400).json({ error: "bad request" });
      const zk = `ls:z:${n}${d}`, hk = `ls:h:${n}${d}`;
      const [fresh] = await pipe([["HSETNX", hk, id, JSON.stringify({ n: name, s })]]);
      if (fresh === 1) await pipe([["ZADD", zk, t, id], ["EXPIRE", zk, TTL], ["EXPIRE", hk, TTL]]);
    }
    res.json(await board(n, id, d));
  } catch (e) { res.status(200).json({ off: true }); }
}
