// Runs once a day (see vercel.json). Sends each reminder at most once per screening.
import { load, save } from "./_store.js";
import { emailAll } from "./_email.js";
import { today } from "./_schedule.js";
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
      p.remind.eve = true;
      await emailAll(s.members, `Tomorrow: ${p.title}`, `Reminder: we're watching "${p.title}" tomorrow at ${p.when.slice(11)}${p.where ? ` at ${p.where}` : ""}.\n\n${PLAN}`);
      sent.push("eve:" + p.title);
    }
    if (td >= plus(day, 3) && td <= plus(day, 10) && !p.remind.survey) { // a few days after: nudge anyone who hasn't answered
      p.remind.survey = true;
      const late = s.members.filter((m) => !(p.survey || {})[m.name]);
      if (late.length) { await emailAll(late, `Survey: ${p.title}`, `You haven't filled out the survey for "${p.title}" yet. It only takes a couple of minutes, and everyone's answers unlock once you save yours.`); sent.push("survey:" + p.title); }
    }
  }
  await save(s);
  res.json({ sent });
}
