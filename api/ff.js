// Fantasy trade matchmaker endpoint. Needs a club login (and FF_ACCESS_CODE if you set one) because it exposes league data.
import { redis } from "./_store.js";
import { sessionUser } from "./_auth.js";
import { loadLeague, demoLeague, leagueBrief, profile, suggestions } from "./_ff.js";

async function getLeague(force) { // cache ESPN data for 10 minutes so we're gentle on ESPN
  const c = await redis.get("ff:league");
  if (c && Date.now() - c.at < 600000 && !(force && Date.now() - c.at > 60000)) return c.league;
  const league = await loadLeague(); await redis.set("ff:league", { at: Date.now(), league }, { ex: 3600 }); return league;
}
const swipeKey = (demo) => (demo ? "ff:swipes:demo" : "ff:swipes");

export default async function handler(req, res) {
  if (!(await sessionUser(req))) return res.status(401).json({ error: "Please log in on the club page first" });
  if (process.env.FF_ACCESS_CODE && req.headers["x-ff-code"] !== process.env.FF_ACCESS_CODE) return res.status(403).json({ error: "Enter the league access code", needCode: true });
  const q = req.method === "GET" ? req.query : req.body || {}, demo = !!q.demo && q.demo !== "0", team = +q.team;
  try {
    const league = demo ? demoLeague() : await getLeague(!!q.refresh), swipes = (await redis.get(swipeKey(demo))) || {};
    if (q.action === "league") return res.json({ league: leagueBrief(league), demo });
    if (q.action === "suggest") {
      const mine = swipes[team] || {}, deals = suggestions(league, team).filter((d) => mine[d.key] !== "pass").map((d) => ({ ...d, liked: mine[d.key] === "like" }));
      return res.json({ profile: profile(league, team), deals, weeksLeft: league.weeksLeft, demo });
    }
    if (q.action === "reset") { swipes[team] = Object.fromEntries(Object.entries(swipes[team] || {}).filter(([, v]) => v === "like")); await redis.set(swipeKey(demo), swipes); return res.json({ ok: true }); } // bring passed trades back
    if (q.action === "swipe") {
      if (!q.key || !["like", "pass"].includes(q.choice)) throw new Error("Bad swipe");
      swipes[team] = { ...(swipes[team] || {}), [q.key]: q.choice }; await redis.set(swipeKey(demo), swipes);
      const other = +q.key.split("|").map((x) => x.split(":")[0]).find((x) => +x !== team);
      return res.json({ match: q.choice === "like" && (swipes[other] || {})[q.key] === "like" });
    }
    if (q.action === "matches") {
      const mine = swipes[team] || {}, out = [];
      for (const key of Object.keys(mine)) {
        if (mine[key] !== "like") continue;
        const other = +key.split("|").map((x) => x.split(":")[0]).find((x) => +x !== team);
        if ((swipes[other] || {})[key] === "like") out.push({ key, team: leagueBrief(league).teams.find((t) => t.id === other) });
      }
      const all = suggestions(league, team), byKey = new Map(all.map((d) => [d.key, d]));
      return res.json({ matches: out.map((m) => ({ ...m, deal: byKey.get(m.key) || null })) });
    }
    throw new Error("Unknown action");
  } catch (e) { res.status(502).json({ error: e.message }); }
}
