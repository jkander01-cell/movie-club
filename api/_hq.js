// League HQ: standings, power rankings, playoff odds, weekly recap, history. Uses the same ESPN access as the trade engine.
// ESPN's data is unofficial; every parser here is defensive and the page hides sections whose data didn't load.
import { FF } from "./_config.js";
import { seasonNow, espnGet, espnFetch, buildSlots, POSNAME } from "./_ff.js";

const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const sd = (a) => { if (a.length < 2) return 0; const m = avg(a); return Math.sqrt(avg(a.map((x) => (x - m) ** 2))); };
const r1 = (x) => Math.round(x * 10) / 10;

// ---------- loading ----------
function parseGames(raw) {
  return (raw.schedule || []).filter((g) => g.home && g.away && g.home.teamId != null && g.away.teamId != null).map((g) => {
    const done = !!g.winner && g.winner !== "UNDECIDED";
    return { id: g.id, week: g.matchupPeriodId, home: g.home.teamId, away: g.away.teamId, hp: +g.home.totalPoints || 0, ap: +g.away.totalPoints || 0, winner: g.winner || "UNDECIDED", done, playoff: !!g.playoffTierType && g.playoffTierType !== "NONE" };
  });
}
function optimal(entries, slots) { // best possible lineup from everyone on the roster that week
  const pool = entries.slice().sort((a, b) => b.pts - a.pts), used = new Set(), picks = []; let total = 0;
  for (const s of slots) for (let i = 0; i < s.n; i++) { const p = pool.find((x) => !used.has(x) && s.elig.includes(x.pos)); if (p) { used.add(p); total += p.pts; picks.push(p); } }
  return { total, picks };
}
function parseBox(j, week, slots) { // -> { teamId: { started, optimal, left, missed[] } }
  const out = {};
  for (const g of j.schedule || []) {
    if (g.matchupPeriodId !== week) continue;
    for (const side of [g.home, g.away]) {
      if (!side || side.teamId == null) continue;
      const roster = side.rosterForCurrentScoringPeriod || side.rosterForMatchupPeriod; if (!roster?.entries?.length) continue;
      const entries = roster.entries.map((e) => ({ slot: e.lineupSlotId, pos: POSNAME[e.playerPoolEntry?.player?.defaultPositionId] || "?", name: e.playerPoolEntry?.player?.fullName || "Unknown", pts: +(e.playerPoolEntry?.appliedStatTotal ?? 0) })).filter((e) => e.pos !== "?");
      const started = entries.filter((e) => e.slot !== 20 && e.slot !== 21), startedPts = started.reduce((s, e) => s + e.pts, 0), opt = optimal(entries.filter((e) => e.slot !== 21), slots);
      const missed = opt.picks.filter((p) => p.slot === 20).sort((a, b) => b.pts - a.pts).slice(0, 3).map((p) => ({ name: p.name, pos: p.pos, pts: r1(p.pts) }));
      out[side.teamId] = { started: r1(startedPts), optimal: r1(opt.total), left: r1(Math.max(0, opt.total - startedPts)), missed };
    }
  }
  return out;
}
export async function loadHQ(redis, force) {
  const season = seasonNow(), key = "hq:data";
  const c = await redis.get(key);
  if (c && c.v === 1 && c.season === season && Date.now() - c.at < 900000 && !(force && Date.now() - c.at > 60000)) return c.data;
  const raw = await espnGet(season, "?view=mTeam&view=mMatchupScore&view=mSettings", "league scores");
  const members = new Map((raw.members || []).map((m) => [m.id, m.displayName || [m.firstName, m.lastName].join(" ")]));
  const teams = (raw.teams || []).map((t) => ({ id: t.id, name: t.name || [t.location, t.nickname].filter(Boolean).join(" ") || `Team ${t.id}`, owner: members.get((t.owners || [])[0]) || "", ownerId: (t.owners || [])[0] || "", final: t.rankCalculatedFinal || 0 }));
  const week = raw.scoringPeriodId || raw.status?.currentMatchupPeriod || 1, sch = raw.settings?.scheduleSettings || {}, regWeeks = sch.matchupPeriodCount || 14;
  const games = parseGames(raw), slots = buildSlots(raw.settings?.rosterSettings?.lineupSlotCounts);
  // box scores for finished weeks (cached forever once fetched; they never change)
  const boxKey = `hq:box:${season}`, box = (await redis.get(boxKey)) || {}, need = [...new Set(games.filter((g) => g.done && !g.playoff).map((g) => g.week))].filter((w) => !box[w] && w <= 18);
  let boxOk = 0;
  await Promise.all(need.map(async (w) => { try { const j = await espnGet(season, `?view=mBoxscore&view=mMatchupScore&scoringPeriodId=${w}`, `week ${w} box scores`); const b = parseBox(j, w, slots); if (Object.keys(b).length) { box[w] = b; boxOk++; } } catch (e) { /* recap works without bench stats */ } }));
  if (boxOk) await redis.set(boxKey, box);
  const data = { topHalf: FF.topHalf !== false, season, week, regWeeks, playoffTeams: sch.playoffTeamCount || 6, teams, games, box, name: raw.settings?.name || "League" };
  await redis.set(key, { v: 1, season, at: Date.now(), data }, { ex: 7200 });
  return data;
}
export async function loadHistory(redis, force) { // past seasons: champions and head-to-head. Best effort: leagues without history just return nothing.
  const season = seasonNow(), c = await redis.get("hq:history");
  if (c && c.v === 1 && c.season === season && Date.now() - c.at < 86400000 && !force) return c.data;
  const out = [];
  await Promise.all([1, 2, 3, 4, 5, 6].map(async (i) => {
    const y = season - i;
    try {
      const j = await espnFetch(`https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/leagueHistory/${FF.leagueId}?seasonId=${y}&view=mTeam&view=mMatchupScore&view=mSettings`, `${y} history`);
      const L = Array.isArray(j) ? j[0] : j; if (!L?.teams?.length) return;
      const members = new Map((L.members || []).map((m) => [m.id, m.displayName || [m.firstName, m.lastName].join(" ")]));
      out.push({ season: y, teams: L.teams.map((t) => ({ id: t.id, name: t.name || [t.location, t.nickname].filter(Boolean).join(" "), owner: members.get((t.owners || [])[0]) || "", ownerId: (t.owners || [])[0] || "", final: t.rankCalculatedFinal || 0 })), games: parseGames(L).filter((g) => g.done) });
    } catch (e) { /* that season isn't available */ }
  }));
  out.sort((a, b) => b.season - a.season);
  await redis.set("hq:history", { v: 1, season, at: Date.now(), data: out }, { ex: 172800 });
  return out;
}

// ---------- results and standings ----------
export function results(data, through = 99) { // finished regular-season games up to a week, as per-team rows
  const rows = [];
  for (const g of data.games) if (g.done && !g.playoff && g.week <= through) {
    const res = g.winner === "HOME" ? "W" : g.winner === "AWAY" ? "L" : "T";
    rows.push({ week: g.week, game: g.id, team: g.home, opp: g.away, pf: g.hp, pa: g.ap, res });
    rows.push({ week: g.week, game: g.id, team: g.away, opp: g.home, pf: g.ap, pa: g.hp, res: res === "W" ? "L" : res === "L" ? "W" : "T" });
  }
  return rows;
}
const median = (arr) => { const a = arr.slice().sort((x, y) => x - y), n = a.length; return n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2; };
function table(data, through) {
  const rows = results(data, through), by = new Map(data.teams.map((t) => [t.id, { id: t.id, w: 0, l: 0, t: 0, hw: 0, hl: 0, ht: 0, mw: 0, ml: 0, mt: 0, pf: 0, pa: 0, games: 0, scores: [], apW: 0, apG: 0 }]));
  for (const r of rows) { const s = by.get(r.team); if (!s) continue; s.games++; s.pf += r.pf; s.pa += r.pa; s.scores.push({ week: r.week, pts: r.pf }); r.res === "W" ? s.hw++ : r.res === "L" ? s.hl++ : s.ht++; }
  const weeks = [...new Set(rows.map((r) => r.week))];
  for (const w of weeks) {
    const wk = rows.filter((r) => r.week === w), med = median(wk.map((r) => r.pf));
    for (const a of wk) {
      const s = by.get(a.team); for (const b of wk) if (b !== a) { s.apG++; if (a.pf > b.pf) s.apW++; else if (a.pf === b.pf) s.apW += 0.5; }
      if (data.topHalf) a.pf > med ? s.mw++ : a.pf < med ? s.ml++ : s.mt++; // the second result of the week: top half of scoring wins, bottom half loses
    }
  }
  for (const s of by.values()) { s.w = s.hw + s.mw; s.l = s.hl + s.ml; s.t = s.ht + s.mt; s.results = s.games * (data.topHalf ? 2 : 1); }
  return [...by.values()];
}
function rankBy(list, f) { const s = list.slice().sort((a, b) => f(b) - f(a)); const m = new Map(); s.forEach((x, i) => m.set(x.id, i + 1)); return m; }
function baseScore(list) { // 45% all-play record, 30% real record, 25% recent scoring
  const n = list.length, recent = list.map((t) => ({ id: t.id, v: avg(t.scores.sort((a, b) => a.week - b.week).slice(-3).map((s) => s.pts)) })), rr = rankBy(recent, (x) => x.v);
  return new Map(list.map((t) => [t.id, 0.45 * (t.apG ? t.apW / t.apG : 0.5) + 0.3 * (t.results ? (t.w + t.t / 2) / t.results : 0.5) + 0.25 * (n > 1 ? (n - rr.get(t.id)) / (n - 1) : 0.5)]));
}
export function overview(data, strengths) {
  const lastDone = Math.max(0, ...results(data).map((r) => r.week)), now = table(data, 99), prev = table(data, lastDone - 1);
  const b0 = baseScore(now), b1 = baseScore(prev), prevRank = rankBy(prev, (t) => b1.get(t.id)), n = data.teams.length;
  const projRank = strengths ? rankBy(data.teams.map((t) => ({ id: t.id })), (t) => strengths.get(t.id) || 0) : null;
  const final = new Map(now.map((t) => [t.id, projRank ? 0.78 * b0.get(t.id) + 0.22 * (n > 1 ? (n - projRank.get(t.id)) / (n - 1) : 0.5) : b0.get(t.id)])), pr = rankBy(now, (t) => final.get(t.id));
  const baseNow = rankBy(now, (t) => b0.get(t.id)), stand = rankBy(now, (t) => t.w + t.t / 2 + t.pf / 1e6);
  const rows = now.map((t) => {
    const team = data.teams.find((x) => x.id === t.id), expW = t.apG ? (t.apW / t.apG) * t.games : 0, last = t.scores.sort((a, b) => a.week - b.week);
    return { id: t.id, name: team.name, owner: team.owner, w: t.w, l: t.l, t: t.t, hw: t.hw, hl: t.hl, ht: t.ht, mw: t.mw, ml: t.ml, mt: t.mt, topHalf: !!data.topHalf, pf: r1(t.pf), pa: r1(t.pa), standing: stand.get(t.id), power: pr.get(t.id), move: lastDone > 1 ? (prevRank.get(t.id) - baseNow.get(t.id)) : 0, apW: r1(t.apW), apL: r1(t.apG - t.apW), expW: r1(expW), luck: r1(t.hw + t.ht / 2 - expW), proj: strengths ? r1(strengths.get(t.id) || 0) : null, last3: r1(avg(last.slice(-3).map((s) => s.pts))), avg: r1(t.games ? t.pf / t.games : 0), blurb: "" };
  }).sort((a, b) => a.power - b.power);
  for (const r of rows) r.blurb = blurb(r, rows.length);
  return { topHalf: !!data.topHalf, season: data.season, week: data.week, through: lastDone, regWeeks: data.regWeeks, playoffTeams: data.playoffTeams, rows, name: data.name };
}
function blurb(r, n) {
  const bits = [];
  if (r.luck >= 1.5) bits.push(`Winning more than the scoring says it should (${r.luck > 0 ? "+" : ""}${r.luck} wins of luck).`);
  else if (r.luck <= -1.5) bits.push(`Unlucky: ${Math.abs(r.luck)} wins worse than the scoring says.`);
  if (r.move >= 2) bits.push(`Up ${r.move} spots this week.`); else if (r.move <= -2) bits.push(`Down ${Math.abs(r.move)} spots this week.`);
  if (r.power <= 2) bits.push("Top of the heap."); else if (r.power >= n - 1) bits.push("Needs help, fast.");
  if (r.proj && r.proj >= r.avg + 6) bits.push("Projects to score a lot more than they have.");
  return bits.slice(0, 2).join(" ") || (r.power <= n / 2 ? "Solid, nothing flashy." : "Hanging in there.");
}

// ---------- playoff odds ----------
const gauss = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
function scoring(data, strengths) { // expected weekly score per team (projection blended with real scoring) and the typical week-to-week swing
  const rows = table(data, 99), allScores = rows.flatMap((t) => t.scores.map((s) => s.pts - t.pf / Math.max(1, t.games))), sigma = Math.max(16, sd(allScores) || 24), mean = new Map();
  for (const t of rows) { const a = t.games ? t.pf / t.games : 100, lam = Math.max(0.35, 0.8 - 0.05 * t.games), p = strengths?.get(t.id); mean.set(t.id, p ? lam * p + (1 - lam) * a : a); }
  return { mean, sigma };
}
const erf = (x) => { const t = 1 / (1 + 0.3275911 * Math.abs(x)), y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x); return x >= 0 ? y : -y; };
export function matchups(data, strengths) { // this week's games with pre-game win chances
  const { mean, sigma } = scoring(data, strengths), nm = (id) => data.teams.find((t) => t.id === id);
  const ids = [...mean.keys()], thCount = new Map(ids.map((i) => [i, 0])), NS = 1500;
  for (let k = 0; k < NS; k++) { const sc = new Map(ids.map((i) => [i, mean.get(i) + sigma * gauss()])), med = median([...sc.values()]); for (const [i, v] of sc) if (v > med) thCount.set(i, thCount.get(i) + 1); }
  const list = data.games.filter((g) => g.week === data.week && !g.playoff).map((g) => {
    const a = nm(g.home), b = nm(g.away), p = 0.5 * (1 + erf((mean.get(g.home) - mean.get(g.away)) / (sigma * Math.SQRT2) / Math.SQRT2));
    const started = g.hp > 0 || g.ap > 0, fav = p >= 0.5 ? a : b, pf = Math.max(p, 1 - p);
    return { id: g.id, home: { id: g.home, name: a?.name, owner: a?.owner, score: r1(g.hp), proj: r1(mean.get(g.home)), top: Math.round((100 * thCount.get(g.home)) / NS) }, away: { id: g.away, name: b?.name, owner: b?.owner, score: r1(g.ap), proj: r1(mean.get(g.away)), top: Math.round((100 * thCount.get(g.away)) / NS) }, homeWin: Math.round(p * 100), done: g.done, started, label: g.done ? "Final" : started ? "In progress" : pf < 0.55 ? "Toss-up" : pf >= 0.8 ? `${fav?.name} heavily favored` : `${fav?.name} favored` };
  });
  const near = list.filter((g) => !g.done).sort((x, y) => Math.abs(x.homeWin - 50) - Math.abs(y.homeWin - 50))[0];
  return { topHalf: !!data.topHalf, week: data.week, games: list, gotw: near ? near.id : null };
}
export function simulate(data, strengths, sims = 4000) {
  const rows = table(data, 99), by = new Map(rows.map((t) => [t.id, t])), remaining = data.games.filter((g) => !g.done && !g.playoff && g.week <= data.regWeeks), N = Math.min(data.playoffTeams, data.teams.length);
  const { mean, sigma } = scoring(data, strengths);
  const pow = 2 ** Math.ceil(Math.log2(N)), byes = pow - N, stat = new Map(data.teams.map((t) => [t.id, { playoff: 0, bye: 0, title: 0, wins: 0, seed: 0, cond: {} }]));
  const left = new Map(data.teams.map((t) => [t.id, remaining.filter((g) => g.home === t.id || g.away === t.id).length * (data.topHalf ? 2 : 1)])), weekGroups = [...new Set(remaining.map((g) => g.week))].map((w) => remaining.filter((g) => g.week === w));
  const play = (a, b) => (mean.get(a) + sigma * gauss() >= mean.get(b) + sigma * gauss() ? a : b);
  for (let s = 0; s < sims; s++) {
    const W = new Map(rows.map((t) => [t.id, t.w + t.t / 2])), PF = new Map(rows.map((t) => [t.id, t.pf])), got = new Map(rows.map((t) => [t.id, 0]));
    for (const wk of weekGroups) {
      const sc = new Map();
      for (const g of wk) { const a = mean.get(g.home) + sigma * gauss(), b = mean.get(g.away) + sigma * gauss(); sc.set(g.home, a); sc.set(g.away, b); PF.set(g.home, PF.get(g.home) + a); PF.set(g.away, PF.get(g.away) + b); const h = a >= b ? g.home : g.away; W.set(h, W.get(h) + 1); got.set(h, got.get(h) + 1); }
      if (data.topHalf) { const med = median([...sc.values()]); for (const [id, v] of sc) if (v > med) { W.set(id, W.get(id) + 1); got.set(id, got.get(id) + 1); } else if (v === med) { W.set(id, W.get(id) + 0.5); got.set(id, got.get(id) + 0.5); } }
    }
    const order = [...W.keys()].sort((x, y) => W.get(y) - W.get(x) || PF.get(y) - PF.get(x)), seeds = order.slice(0, N);
    order.forEach((id, i) => { const st = stat.get(id), k = Math.round(got.get(id)); st.wins += W.get(id); st.seed += i + 1; const c = (st.cond[k] = st.cond[k] || { n: 0, make: 0 }); c.n++; if (i < N) c.make++; });
    seeds.forEach((id, i) => { const st = stat.get(id); st.playoff++; if (i < byes) st.bye++; });
    let alive = seeds.slice(byes), won = [];
    for (let i = 0; i < alive.length / 2; i++) won.push(play(alive[i], alive[alive.length - 1 - i]));
    let field = [...seeds.slice(0, byes), ...won];
    while (field.length > 1) { field.sort((x, y) => seeds.indexOf(x) - seeds.indexOf(y)); const nx = []; for (let i = 0; i < field.length / 2; i++) nx.push(play(field[i], field[field.length - 1 - i])); field = nx; }
    if (field[0] != null) stat.get(field[0]).title++;
  }
  const out = data.teams.map((t) => {
    const st = stat.get(t.id), rr = by.get(t.id), m = left.get(t.id);
    const table = Object.keys(st.cond).map(Number).sort((a, b) => a - b).map((k) => ({ wins: k, of: m, odds: Math.round((100 * st.cond[k].make) / st.cond[k].n), n: st.cond[k].n })).filter((x) => x.n >= sims * 0.01);
    return { id: t.id, name: t.name, owner: t.owner, w: rr.w, l: rr.l, t: rr.t, hw: rr.hw, hl: rr.hl, mw: rr.mw, ml: rr.ml, playoff: Math.round((100 * st.playoff) / sims), bye: Math.round((100 * st.bye) / sims), title: +((100 * st.title) / sims).toFixed(1), avgWins: r1(st.wins / sims), avgSeed: r1(st.seed / sims), left: m, table, line: pathLine(table, m, Math.round((100 * st.playoff) / sims)) };
  }).sort((a, b) => b.playoff - a.playoff || b.title - a.title);
  return { topHalf: !!data.topHalf, sims, playoffTeams: N, byes, left: remaining.length ? Math.max(...left.values()) : 0, teams: out };
}
function pathLine(table, m, odds) {
  if (!m) return odds >= 99 ? "Clinched a playoff spot." : odds <= 1 ? "Eliminated from the playoffs." : `Regular season is over: ${odds}% to be in.`;
  if (odds >= 99) return "Nearly locked in.";
  if (odds <= 1) return "Needs a miracle: basically out.";
  const ok = table.find((x) => x.odds >= 50);
  if (!ok) return `Even winning out only gets you to about ${table[table.length - 1]?.odds ?? 0}%. You need help from other teams.`;
  if (ok.wins === 0) return "Likely in even with a few losses, but win to be safe.";
  return `Win ${ok.wins} of your last ${m} results and you're about ${ok.odds}% to get in.`;
}

// ---------- weekly recap ----------
const pick = (arr, seed) => arr[Math.abs(seed) % arr.length];
export function recap(data, week) {
  const rows = results(data, 99), weeks = [...new Set(rows.map((r) => r.week))].sort((a, b) => a - b);
  if (!weeks.length) return { weeks: [], empty: "No games have finished yet. The first recap appears after week 1." };
  week = weeks.includes(+week) ? +week : weeks[weeks.length - 1];
  const name = (id) => data.teams.find((t) => t.id === id)?.name || `Team ${id}`, games = data.games.filter((g) => g.week === week && g.done && !g.playoff), box = data.box?.[week] || null;
  const list = games.map((g) => { const wnH = g.winner === "HOME", w = wnH ? g.home : g.away, l = wnH ? g.away : g.home, wp = wnH ? g.hp : g.ap, lp = wnH ? g.ap : g.hp; return { id: g.id, tie: g.winner === "TIE", winner: w, loser: l, winnerName: name(w), loserName: name(l), wp: r1(wp), lp: r1(lp), margin: r1(Math.abs(g.hp - g.ap)) }; });
  const scores = list.flatMap((g) => [{ id: g.winner, pts: g.wp }, { id: g.loser, pts: g.lp }]).sort((a, b) => b.pts - a.pts), n = scores.length;
  const top = scores[0], bottom = scores[n - 1], close = list.slice().sort((a, b) => a.margin - b.margin)[0], blow = list.slice().sort((a, b) => b.margin - a.margin)[0];
  const rank = new Map(scores.map((s, i) => [s.id, i + 1]));
  const unlucky = list.filter((g) => !g.tie).map((g) => ({ ...g, rk: rank.get(g.loser) })).sort((a, b) => a.rk - b.rk)[0];
  const lucky = list.filter((g) => !g.tie).map((g) => ({ ...g, rk: rank.get(g.winner) })).sort((a, b) => b.rk - a.rk)[0];
  const med = median(scores.map((s) => s.pts)), topHalf = data.topHalf ? scores.filter((s) => s.pts > med).map((s) => name(s.id)) : [];
  const cards = [];
  if (top) cards.push({ title: "Team of the week", team: name(top.id), text: `${top.pts} points, the top score in the league.` });
  if (bottom) cards.push({ title: "Scrub of the week", team: name(bottom.id), text: `${bottom.pts} points, the lowest in the league. We believe in you, next week maybe.` });
  if (close) cards.push({ title: "Nail-biter", team: `${close.winnerName} over ${close.loserName}`, text: `${close.wp} to ${close.lp}, decided by ${close.margin}.` });
  if (blow && blow !== close) cards.push({ title: "Blowout", team: `${blow.winnerName} over ${blow.loserName}`, text: `${blow.wp} to ${blow.lp}. A ${blow.margin}-point beating.` });
  if (unlucky && unlucky.rk <= Math.ceil(n / 2)) cards.push({ title: "Unluckiest loss", team: unlucky.loserName, text: `Scored ${unlucky.lp}, which was ${unlucky.rk === 1 ? "the top score" : "#" + unlucky.rk + " in the league"}, and still lost to ${unlucky.winnerName}.${data.topHalf && unlucky.lp > med ? " At least it earned a top-half win." : ""}` });
  if (lucky && lucky.rk > Math.floor(n / 2)) cards.push({ title: "Luckiest win", team: lucky.winnerName, text: `Won with ${lucky.wp}, only #${lucky.rk} in the league, against ${lucky.loserName}.` });
  let bench = null, mgr = null;
  if (box) {
    const bx = Object.entries(box).map(([id, b]) => ({ id: +id, ...b })).filter((b) => data.teams.some((t) => t.id === b.id));
    const worst = bx.slice().sort((a, b) => b.left - a.left)[0];
    if (worst && worst.left > 0) { bench = { team: name(worst.id), left: worst.left, missed: worst.missed }; cards.push({ title: "Bench of shame", team: name(worst.id), text: `Left ${worst.left} points on the bench${worst.missed.length ? ": " + worst.missed.map((m) => `${m.name} (${m.pts})`).join(", ") : ""}.` }); }
    const best = bx.filter((b) => b.optimal > 0).sort((a, b) => b.started / b.optimal - a.started / a.optimal)[0];
    if (best) { mgr = { team: name(best.id), pct: Math.round((100 * best.started) / best.optimal) }; cards.push({ title: "Manager of the week", team: name(best.id), text: `Set ${mgr.pct}% of the best possible lineup.` }); }
  }
  const T = (g, i) => g.tie ? `${g.winnerName} and ${g.loserName} tied ${g.wp}-${g.lp}. Nobody wins, everybody argues.` : g.margin < 5 ? pick([`${g.winnerName} survives ${g.loserName}, ${g.wp}-${g.lp}.`, `${g.winnerName} edges ${g.loserName} by ${g.margin}. Somebody is checking the stat corrections.`], i) : g.margin > 40 ? pick([`${g.winnerName} destroys ${g.loserName}, ${g.wp}-${g.lp}.`, `${g.loserName} never showed up. ${g.winnerName} wins by ${g.margin}.`], i) : pick([`${g.winnerName} beats ${g.loserName}, ${g.wp}-${g.lp}.`, `${g.winnerName} takes care of ${g.loserName} ${g.wp}-${g.lp}.`, `${g.loserName} falls to ${g.winnerName}, ${g.lp}-${g.wp}.`], i);
  const headline = top ? `${name(top.id)} led the league with ${top.pts} points` + (blow ? `, and ${blow.winnerName} beat up ${blow.loserName} by ${blow.margin}.` : ".") : `Week ${week} recap`;
  return { weeks, week, headline, games: list.map((g, i) => ({ ...g, line: T(g, i + week) })), cards, hasBench: !!box, bench, mgr, topHalf };
}
export function recapText(r, league) { // plain-text version for the Tuesday email
  const L = [`${league || "League"}: week ${r.week} recap`, "", r.headline, "", "Scores:"];
  r.games.forEach((g) => L.push(`  ${g.line}`)); L.push("");
  r.cards.forEach((c) => L.push(`${c.title}: ${c.team}. ${c.text}`));
  if (r.topHalf?.length) L.push("", `Top-half club (won the vs-league result): ${r.topHalf.join(", ")}`);
  return L.join("\n");
}

// ---------- history ----------
export function history(hist, data, myOwnerId) {
  const seasons = [...hist, { season: data.season, teams: data.teams, games: data.games.filter((g) => g.done && !g.playoff) }];
  const champs = hist.map((h) => { const c = h.teams.find((t) => t.final === 1); return c ? { season: h.season, team: c.name, owner: c.owner } : null; }).filter(Boolean);
  const titles = {}; champs.forEach((c) => { titles[c.owner || c.team] = (titles[c.owner || c.team] || 0) + 1; });
  const owners = new Map(); data.teams.forEach((t) => owners.set(t.ownerId, t.owner));
  const rec = {}; // owner vs owner across all seasons
  for (const s of seasons) {
    const own = new Map(s.teams.map((t) => [t.id, t.ownerId]));
    for (const g of s.games) { const a = own.get(g.home), b = own.get(g.away); if (!a || !b || a === b) continue; const ra = (rec[a] = rec[a] || {}), rb = (rec[b] = rec[b] || {}); ra[b] = ra[b] || { w: 0, l: 0, t: 0 }; rb[a] = rb[a] || { w: 0, l: 0, t: 0 }; if (g.winner === "HOME") { ra[b].w++; rb[a].l++; } else if (g.winner === "AWAY") { ra[b].l++; rb[a].w++; } else { ra[b].t++; rb[a].t++; } }
  }
  const mine = rec[myOwnerId] || {}, rivals = Object.entries(mine).map(([id, r]) => ({ owner: owners.get(id) || "Former owner", ...r, games: r.w + r.l + r.t })).filter((r) => r.games > 0).sort((a, b) => b.games - a.games);
  return { seasonsLoaded: hist.length, champs, titles: Object.entries(titles).map(([owner, n]) => ({ owner, n })).sort((a, b) => b.n - a.n), rivals };
}
