// Runs once a day (see vercel.json). Sends each reminder at most once per screening.
import { load, save } from "./_store.js";
import { emailAll } from "./_email.js";
import { today } from "./_schedule.js";
import { redis } from "./_store.js";
import { loadHQ, recap, recapText } from "./_hq.js";
const plus = (ymd, n) => new Date(Date.parse(ymd) + n * 864e5).toISOString().slice(0, 10);
const PLAN = "We watch together at the same time. Can't make it? Watch on your own beforehand.";
export default async function handler(req, res) {
  if (process.env.CRON_SECRET && req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) return res.status(401).json({ error: "Unauthorized" });
  const s = await load(), td = today(), sent = [];
  for (const p of s.picks) {
    if (!p.when || p.status === "draft") continue;
    const day = p.when.slice(0, 10);
    p.remind = p.remind || {};
    if (day === plus(td, 1) && !p.remind.eve) { // the day before
      const r = await emailAll(s.members, `Tomorrow: ${p.title}`, `Reminder: we're watching "${p.title}" tomorrow at ${p.when.slice(11)}${p.where ? ` at ${p.where}` : ""}.\n\n${PLAN}`);
      if (r.ok) { p.remind.eve = true; sent.push("eve:" + p.title); }
    }
    if (td >= plus(day, 3) && td <= plus(day, 10) && !p.remind.survey) { // a few days after: nudge anyone who hasn't answered
      const late = s.members.filter((m) => !(p.survey || {})[m.name]);
      if (!late.length) p.remind.survey = true;
      else { const r = await emailAll(late, `Survey: ${p.title}`, `You haven't filled out the survey for "${p.title}" yet. It only takes a couple of minutes, and everyone's answers unlock once you save yours.`); if (r.ok) { p.remind.survey = true; sent.push("survey:" + p.title); } }
    }
  }
  await save(s);
  try { // Tuesday morning (Eastern): email the fantasy league recap once the week's games are final
    const dow = new Date().toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "short" });
    if (dow === "Tue" && process.env.HQ_EMAIL !== "off") {
      const data = await loadHQ(redis, true), r = recap(data), flag = `hq:sent:${data.season}:${r.week}`;
      const weekGames = data.games.filter((g) => g.week === r.week && !g.playoff);
      if (r.weeks.length && weekGames.length && weekGames.every((g) => g.done) && !(await redis.get(flag))) {
        const em = await emailAll(s.members, `${data.name}: week ${r.week} recap`, `${recapText(r, data.name)}\n\nFull recap, power rankings and playoff odds: https://majordudemedia.com/league`);
        if (em.ok) { await redis.set(flag, 1); sent.push("hq:" + r.week); }
      }
    }
  } catch (e) { /* the league recap is a bonus; never let it break movie reminders */ }
  res.json({ sent });
}
