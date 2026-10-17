// Multiplayer endpoint for the settlers game. State lives in Redis; clients poll for changes (no websockets needed).
import { redis } from "./_store.js";
import { sessionUser } from "./_auth.js";
import * as G from "./_catan.js";
const key = (c) => `catan:${String(c || "").toUpperCase()}`;
const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const code4 = () => Array.from({ length: 4 }, () => letters[Math.floor(Math.random() * letters.length)]).join("");
const put = (s) => redis.set(key(s.code), s, { ex: 60 * 60 * 24 }); // games expire after a day
const meIn = (s, user) => s.players.findIndex((p) => p.name === user);

export default async function handler(req, res) {
  const user = await sessionUser(req);
  if (!user) return res.status(401).json({ error: "Please log in on the club page first" });
  try {
    if (req.method === "GET") { // poll: only send the full view when something changed
      const s = await redis.get(key(req.query.code));
      if (!s) return res.status(404).json({ error: "Game not found" });
      if (+req.query.v === s.version && +req.query.pi === meIn(s, user) && !req.query.full) return res.json({ same: true });
      return res.json({ view: G.view(s, meIn(s, user)), ...(req.query.full && s.status !== "lobby" ? { geo: G.geoPublic() } : {}) });
    }
    const b = req.body || {};
    if (b.action === "list") {
      const codes = (await redis.get("catan:codes")) || [], out = [];
      for (const c of codes) { const s = await redis.get(key(c)); if (s && (s.status === "lobby" || (s.status === "playing" && meIn(s, user) >= 0))) out.push({ code: s.code, host: s.host, status: s.status, players: s.players.map((p) => p.name), mine: meIn(s, user) >= 0 }); }
      return res.json({ games: out });
    }
    if (b.action === "create") {
      let c = code4(); while (await redis.get(key(c))) c = code4();
      const s = G.newLobby(c, user); await put(s);
      const codes = ((await redis.get("catan:codes")) || []).filter((x) => x !== c).slice(-29); codes.push(c); await redis.set("catan:codes", codes);
      return res.json({ code: c, view: G.view(s, 0) });
    }
    const s = await redis.get(key(b.code));
    if (!s) return res.status(404).json({ error: "Game not found" });
    if (b.action === "join") G.joinLobby(s, user);
    else if (b.action === "leave") G.leaveLobby(s, user);
    else if (b.action === "start") { if (s.host !== user) throw new Error("Only the host can start"); G.startGame(s); }
    else if (b.action === "act") G.apply(s, meIn(s, user), b.a || {});
    else throw new Error("Unknown action");
    await put(s);
    return res.json({ view: G.view(s, meIn(s, user)), ...(s.status !== "lobby" ? { geo: G.geoPublic() } : {}) });
  } catch (e) { res.status(400).json({ error: e.message }); }
}
