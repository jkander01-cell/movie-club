// Fantasy trade matchmaker endpoint. Needs a club login (and FF_ACCESS_CODE if you set one) because it exposes league data.
import { redis } from "./_store.js";
import { sessionUser } from "./_auth.js";
import { cachedLeague, demoLeague, leagueBrief, profile, suggestions, diagnose } from "./_ff.js";

const getLeague = (force) => cachedLeague(redis, force);
const swipeKey = (demo) => (demo ? "ff:swipes:demo" : "ff:swipes");

export default async function handler(req, res) {
  if (!(await sessionUser(req))) return res.status(401).json({ error: "Please log in on the club page first" });
  const need0 = (process.env.FF_ACCESS_CODE || "").trim(), need = need0, given = String(req.headers["x-ff-code"] || "").trim();
  if ((req.query || {}).action === "status") return res.json({ codeRequired: !!need });
  if (need && given !== need) return res.status(403).json({ error: given ? "That access code isn't right. Try again." : "Enter the league access code", needCode: true, wrong: !!given });
  const q = req.method === "GET" ? req.query : req.body || {}, demo = !!q.demo && q.demo !== "0", team = +q.team;
  try {
    if (q.action === "diagnose") return res.json(await diagnose());
    const league = demo ? demoLeague() : await getLeague(!!q.refresh), swipes = (await redis.get(swipeKey(demo))) || {};
    if (q.action === "league") return res.json({ league: leagueBrief(league), demo });
    if (q.action === "suggest") {
      const mine = swipes[team] || {}, sg = suggestions(league, team), deals = sg.deals.filter((d) => mine[d.key] !== "pass").map((d) => ({ ...d, liked: mine[d.key] === "like" }));
      return res.json({ profile: profile(league, team), deals, stats: sg.stats, weeksLeft: league.weeksLeft, demo });
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
      const all = suggestions(league, team).deals, byKey = new Map(all.map((d) => [d.key, d]));
      return res.json({ matches: out.map((m) => ({ ...m, deal: byKey.get(m.key) || null })) });
    }
    throw new Error("Unknown action");
  } catch (e) { res.status(502).json({ error: e.message }); }
}
