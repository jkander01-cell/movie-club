// Club stats, taste matching and the year-end "wrapped" numbers. Pure functions over the club state.
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const sd = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };
const yearOf = (p) => String((p.when || new Date(p.at).toISOString()).slice(0, 4));
const tally = (arr) => { const c = {}; arr.forEach((x) => { c[x] = (c[x] || 0) + 1; }); return Object.entries(c).sort((a, b) => b[1] - a[1]); };
const r1 = (n) => (n == null ? null : Math.round(n * 10) / 10);

export function stats(s, year) {
  const all = s.picks.filter((p) => p.status !== "draft");
  const years = [...new Set(all.map(yearOf))].sort().reverse();
  const picks = year ? all.filter((p) => yearOf(p) === String(year)) : all;
  const rows = picks.map((p) => {
    const v = Object.values(p.ratings || {});
    return { at: p.at, title: p.title, year: p.movie?.year, poster: p.movie?.poster, by: p.by, n: v.length, avg: r1(mean(v)), spread: v.length >= 3 ? r1(sd(v)) : null, hi: v.length ? Math.max(...v) : null, lo: v.length ? Math.min(...v) : null };
  });
  const rated = rows.filter((r) => r.n >= 2);
  const best = [...rated].sort((a, b) => b.avg - a.avg).slice(0, 3);
  const worst = rated.length > 3 ? [...rated].sort((a, b) => a.avg - b.avg).slice(0, 1) : [];
  const divisive = rows.filter((r) => r.spread != null).sort((a, b) => b.spread - a.spread).slice(0, 3);

  const by = {};
  for (const r of rows) { const o = (by[r.by] = by[r.by] || { name: r.by, picks: 0, avgs: [], hearts: 0 }); o.picks++; if (r.avg != null) o.avgs.push(r.avg); }
  for (const v of Object.values(s.suggestions || {})) { const o = (by[v.by] = by[v.by] || { name: v.by, picks: 0, avgs: [], hearts: 0 }); o.hearts += (v.hearts || []).length; }
  const suggesters = Object.values(by).map((o) => ({ name: o.name, picks: o.picks, avg: r1(mean(o.avgs)), hearts: o.hearts })).sort((a, b) => (b.avg ?? -1) - (a.avg ?? -1) || b.picks - a.picks);
  const topSuggester = suggesters.find((x) => x.avg != null && x.picks >= 1) || null;
  const hearted = Object.values(s.suggestions || {}).map((v) => ({ title: v.title, by: v.by, hearts: (v.hearts || []).length, picked: !!v.picked, poster: v.movie?.poster })).filter((v) => v.hearts).sort((a, b) => b.hearts - a.hearts).slice(0, 5);

  // Raters: everyone's overall generosity, counting only ratings on the club's screenings in range
  const rater = {};
  for (const p of picks) for (const [n, sc] of Object.entries(p.ratings || {})) (rater[n] = rater[n] || []).push(sc);
  const raters = Object.entries(rater).map(([name, a]) => ({ name, n: a.length, avg: r1(mean(a)) })).sort((a, b) => b.avg - a.avg);
  const generous = raters.filter((r) => r.n >= 2);

  // Attendance: who said "watching live", and who answered the survey
  const att = {}, svy = {};
  for (const p of picks) {
    for (const [n, v] of Object.entries(p.rsvp || {})) if (v === "live") att[n] = (att[n] || 0) + 1;
    for (const n of Object.keys(p.survey || {})) svy[n] = (svy[n] || 0) + 1;
  }
  const attendance = Object.entries(att).map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n);
  const surveys = Object.entries(svy).map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n);

  const answers = picks.flatMap((p) => Object.values(p.survey || {}));
  const vibes = tally(answers.map((a) => a.vibe).filter(Boolean)).slice(0, 3);
  const bestPart = tally(answers.map((a) => a.best).filter(Boolean)).slice(0, 3);
  const again = answers.filter((a) => a.again).length ? Math.round((100 * answers.filter((a) => a.again === "yes").length) / answers.filter((a) => a.again).length) : null;

  // Taste match: compare every pair of members on the movies they both rated (any movie, not just screenings)
  const mine = s.myRatings || {}, names = Object.keys(mine), pairs = [];
  for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
    const A = mine[names[i]], B = mine[names[j]], shared = Object.keys(A).filter((id) => B[id]);
    if (shared.length < 3) continue;
    const diffs = shared.map((id) => Math.abs(A[id].score - B[id].score)), d = mean(diffs);
    const worstId = shared.sort((x, y) => Math.abs(A[y].score - B[y].score) - Math.abs(A[x].score - B[x].score))[0];
    pairs.push({ a: names[i], b: names[j], n: shared.length, match: Math.max(0, Math.round(100 - d * 11)), clash: { title: A[worstId].title, a: A[worstId].score, b: B[worstId].score } });
  }
  pairs.sort((x, y) => y.match - x.match);

  return {
    year: year || null, years, count: picks.length, ratings: rows.reduce((t, r) => t + r.n, 0), members: s.members.length,
    best, worst, divisive, topSuggester, suggesters, hearted, raters: generous.length ? generous : raters,
    generous: generous[0] || null, harshest: generous.length > 1 ? generous[generous.length - 1] : null,
    attendance, surveys, vibes, bestPart, again, pairs, avgAll: r1(mean(rated.map((r) => r.avg))),
  };
}
