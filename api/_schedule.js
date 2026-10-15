import { SCHEDULE as S } from "./_config.js";
const ymd = (d) => d.toISOString().slice(0, 10);
export const today = () => new Date().toLocaleDateString("en-CA", { timeZone: S.timezone });
// Next `count` regular screening dates (YYYY-MM-DD) on or after `from`
export function upcoming(from, count = 4) {
  const out = []; let [y, m] = from.split("-").map(Number); m -= 1;
  while (out.length < count) {
    const off = (S.weekday - new Date(Date.UTC(y, m, 1)).getUTCDay() + 7) % 7;
    for (const n of [...S.nth].sort()) {
      const d = new Date(Date.UTC(y, m, 1 + off + (n - 1) * 7));
      if (d.getUTCMonth() === m && ymd(d) >= from) out.push(ymd(d));
    }
    if (++m > 11) { m = 0; y++; }
  }
  return out.slice(0, count);
}
// Regular dates minus the ones the organizer skipped, plus any one-off dates they added (s.sched = {skip, extra})
export function effective(s, count = 4) {
  const skip = new Set(s.sched?.skip || []), extra = s.sched?.extra || [], t = today();
  return [...new Set([...upcoming(t, count + skip.size + 2).filter((d) => !skip.has(d)), ...extra.filter((d) => d >= t)])].sort().slice(0, count);
}
export function schedule(s) {
  const dates = effective(s, 4);
  return { dates, drawBy: dates.map((d) => ymd(new Date(Date.parse(d) - S.drawDaysBefore * 864e5))), time: S.time, base: upcoming(today(), 8), skip: s.sched?.skip || [], extra: s.sched?.extra || [] };
}
