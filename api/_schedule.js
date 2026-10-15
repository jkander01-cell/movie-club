import { SCHEDULE as S } from "./_config.js";
const ymd = (d) => d.toISOString().slice(0, 10);
export const today = () => new Date().toLocaleDateString("en-CA", { timeZone: S.timezone });
// Next `count` screening dates (YYYY-MM-DD) on or after `from`
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
export function schedule() {
  const dates = upcoming(today(), 4);
  return { dates, drawBy: dates.map((d) => ymd(new Date(Date.parse(d) - S.drawDaysBefore * 864e5))), time: S.time };
}
