// Fantasy trade matchmaker endpoint. Needs a club login (and FF_ACCESS_CODE if you set one) because it exposes league data.
import { redis } from "./_store.js";
import { sessionUser } from "./_auth.js";
import { load } from "./_store.js";
import { emailAll } from "./_email.js";
import { cachedLeague, demoLeague, leagueBrief, profile, suggestions, diagnose } from "./_ff.js";

const getLeague = (force) => cachedLeague(redis, force);
const SITE = "https://majordudemedia.com";
async function owners(team) { // club users who said "this is my team" on the trade page
  const all = (await redis.get("ff:owners")) || {}; return Object.entries(all).filter(([, t]) => +t === team).map(([u]) => u);
}
async function tell(users, subject, text, nudgeKey) { // best-effort email to club users; never blocks or breaks a swipe
  try {
    if (process.env.FF_EMAIL === "off" || !users.length) return;
    const s = await load(), people = s.members.filter((m) => users.includes(String(m.name).toLowerCase()) && m.email);
    const fresh = []; for (const m of people) { if (nudgeKey) { const k = `${nudgeKey}:${String(m.name).toLowerCase()}`; if (await redis.get(k)) continue; await redis.set(k, 1, { ex: 86400 }); } fresh.push(m); }
    if (fresh.length) await emailAll(fresh, subject, text);
  } catch (e) { /* email is a bonus */ }
}
const clip = (x) => String(x || "").slice(0, 160);
const swipeKey = (demo) => (demo ? "ff:swipes:demo" : "ff:swipes");

export default async function handler(req, res) {
  const user = await sessionUser(req);
  if (!user) return res.status(401).json({ error: "Please log in on the club page first" });
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
    if (q.action === "claim") { // remember which team this club login plays as, so matches can be emailed
      if (!demo && team) { const all = (await redis.get("ff:owners")) || {}; all[String(user).toLowerCase()] = team; await redis.set("ff:owners", all); }
      return res.json({ ok: true });
    }
    if (q.action === "swipe") {
      if (!q.key || !["like", "pass"].includes(q.choice)) throw new Error("Bad swipe");
      swipes[team] = { ...(swipes[team] || {}), [q.key]: q.choice }; await redis.set(swipeKey(demo), swipes);
      const other = +q.key.split("|").map((x) => x.split(":")[0]).find((x) => +x !== team), match = q.choice === "like" && (swipes[other] || {})[q.key] === "like";
      if (q.choice === "like" && !demo) {
        const give = clip(q.give), get = clip(q.get); // the swiper's view: they give `give` and get `get`
        if (match) {
          await tell(await owners(other), "It's a trade match!", `You and another owner both liked this trade idea:\n\nYou give: ${get}\nYou get: ${give}\n\nGo propose it in ESPN. See it here: ${SITE}/trades`);
          await tell(await owners(team), "It's a trade match!", `You and another owner both liked this trade idea:\n\nYou give: ${give}\nYou get: ${get}\n\nGo propose it in ESPN. See it here: ${SITE}/trades`);
        } else await tell(await owners(other), "Someone pitched you a trade idea", `Another owner liked a trade idea that involves your team. Open Trade Match to see your ideas and swipe: ${SITE}/trades`, "ff:nudge");
      }
      return res.json({ match });
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
