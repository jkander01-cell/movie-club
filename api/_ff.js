// Fantasy trade matchmaker: loads an ESPN league and finds trades that make BOTH teams' best lineup better.
// ESPN has no official public API; this uses the same data ESPN's own site uses, so it can change without notice.
import { FF } from "./_config.js";

const POS = { 1: "QB", 2: "RB", 3: "WR", 4: "TE", 5: "K", 16: "DST" };
export const SLOT = { 0: ["QB"], 2: ["RB"], 3: ["RB", "WR"], 4: ["WR"], 5: ["WR", "TE"], 6: ["TE"], 7: ["QB", "RB", "WR", "TE"], 16: ["DST"], 17: ["K"], 23: ["RB", "WR", "TE"] };
const NFL = { 1: "ATL", 2: "BUF", 3: "CHI", 4: "CIN", 5: "CLE", 6: "DAL", 7: "DEN", 8: "DET", 9: "GB", 10: "TEN", 11: "IND", 12: "KC", 13: "LV", 14: "LAR", 15: "MIA", 16: "MIN", 17: "NE", 18: "NO", 19: "NYG", 20: "NYJ", 21: "PHI", 22: "ARI", 23: "PIT", 24: "LAC", 25: "SF", 26: "SEA", 27: "TB", 28: "WSH", 29: "CAR", 30: "JAX", 33: "BAL", 34: "HOU" };
const TUNE = { minGainPerWeek: 0.25, minFairness: 0.85, candidates: 11, pairPool: 6, faPerPos: 2, maxPerTeam: 3, maxDeals: 30 };
export const seasonNow = () => { const d = new Date(); return +process.env.ESPN_SEASON || (d.getMonth() < 2 ? d.getFullYear() - 1 : d.getFullYear()); };

// ---------- loading from ESPN ----------
export async function loadLeague() {
  const season = seasonNow(), headers = { Accept: "application/json" };
  if (process.env.ESPN_S2 && process.env.ESPN_SWID) headers.Cookie = `espn_s2=${process.env.ESPN_S2}; SWID=${process.env.ESPN_SWID}`;
  const HOSTS = ["lm-api-reads.fantasy.espn.com", "fantasy.espn.com"];
  const get = async (qs, extra, label = "league") => {
    let last = "";
    for (const host of HOSTS) {
      let r; try { r = await fetch(`https://${host}/apis/v3/games/ffl/seasons/${season}/segments/0/leagues/${FF.leagueId}${qs}`, { headers: { ...headers, ...extra } }); } catch (e) { last = `couldn't connect to ${host} (${e.message})`; continue; }
      if (r.status === 401 || r.status === 403) throw new Error(headers.Cookie ? "ESPN rejected the login cookies. They may have expired or been copied wrong: use Check ESPN connection, then copy fresh espn_s2 and SWID values into Vercel." : "ESPN says this league is private. Add ESPN_S2 and ESPN_SWID in Vercel, then redeploy.");
      if (r.status === 404) throw new Error(`ESPN couldn't find league ${FF.leagueId} for the ${season} season.`);
      const text = await r.text();
      if (!r.ok) throw new Error(`ESPN rejected the ${label} request (error ${r.status}): ${text.replace(/\s+/g, " ").slice(0, 160)}`);
      try { return JSON.parse(text); } catch (e) { throw new Error(`ESPN sent a web page instead of data for the ${label} request: ${text.replace(/\s+/g, " ").slice(0, 100)}`); }
    }
    throw new Error(`Couldn't reach ESPN for the ${label} request: ${last || "no response"}.`);
  };
  const raw = await get("?view=mTeam&view=mRoster&view=mSettings", undefined, "league");
  const ids = (raw.teams || []).flatMap((t) => (t.roster?.entries || []).map((e) => e.playerId));
  if (!ids.length) throw new Error("ESPN sent the league but no rostered players. Has the draft happened yet for this season?");
  const stat = (split) => ({ filterStatsForSourceIds: { value: [0, 1] }, ...(split ? { filterStatsForSplitTypeIds: { value: [0] } } : {}) });
  const ask = (label, mk) => get("?view=kona_player_info", { "x-fantasy-filter": JSON.stringify({ players: mk }) }, label);
  let rostered = null, lastErr;
  for (const mk of [() => ({ filterIds: { value: ids }, ...stat(true), limit: ids.length + 25 }), () => ({ filterIds: { value: ids }, ...stat(false), limit: ids.length + 25 }), () => ({ filterIds: { value: ids }, limit: ids.length + 25 })]) {
    try { rostered = await ask("player projections", mk); if ((rostered.players || []).length) break; } catch (e) { lastErr = e; if (/login|private|find league/.test(e.message)) throw e; }
  }
  if (!rostered || !(rostered.players || []).length) throw lastErr || new Error("ESPN returned no player data for the rosters.");
  let free = { players: [] };
  try { free = await ask("free agent", () => ({ filterStatus: { value: ["FREEAGENT", "WAIVERS"] }, filterSlotIds: { value: [0, 2, 4, 6] }, ...stat(true), limit: 120, sortPercOwned: { sortPriority: 1, sortAsc: false } })); } catch (e) { /* replacement level falls back to a default */ }
  const league = normalize(raw, rostered.players || [], free.players || [], season, await loadSchedule(season));
  if (!league.teams.some((t) => t.players.some((p) => p.ppg > 0))) throw new Error("ESPN sent the rosters but no projection numbers (the season may not have projections yet).");
  return league;
}

function rate(stats, season, week) { // per-game points: season projection blended with real results as the season goes on
  const own = (stats || []).filter((s) => s.seasonId === season && s.statSplitTypeId === 0);
  const proj = own.find((s) => s.statSourceId === 1), act = own.find((s) => s.statSourceId === 0);
  const pa = proj ? proj.appliedAverage ?? (proj.appliedTotal ? proj.appliedTotal / 17 : null) : null, aa = act?.appliedAverage ?? null;
  const w = Math.min(0.6, (week - 1) / (week + 5));
  const wk = (stats || []).find((s) => s.statSplitTypeId === 1 && s.statSourceId === 1 && s.scoringPeriodId === week);
  const ppg = pa != null && aa != null && aa > 0 ? (1 - w) * pa + w * aa : pa ?? aa ?? 0;
  return { ppg: Math.max(0, ppg), wk: wk && wk.appliedTotal > 0 ? wk.appliedTotal : 0 };
}
function mkPlayer(p, season, week, slot) {
  const pl = p.player || p, r = rate(pl.stats, season, week);
  return { id: p.id ?? pl.id, name: pl.fullName || "Unknown", pos: POS[pl.defaultPositionId] || "?", nfl: NFL[pl.proTeamId] || "FA", inj: pl.injuryStatus || "ACTIVE", ppg: r.ppg, wk: r.wk, slot };
}
function normalize(raw, rostered, free, season, sched) {
  const week = raw.scoringPeriodId || raw.status?.currentMatchupPeriod || 1;
  const counts = raw.settings?.rosterSettings?.lineupSlotCounts || {};
  const slots = Object.entries(counts).filter(([k, n]) => SLOT[k] && n > 0).map(([k, n]) => ({ name: SLOT[k].length === 1 ? SLOT[k][0] : SLOT[k].join("/") === "RB/WR/TE" ? "FLEX" : SLOT[k].join("/"), n, elig: SLOT[k] })).sort((a, b) => a.elig.length - b.elig.length);
  const byId = new Map(rostered.map((p) => [p.id, p])), members = new Map((raw.members || []).map((m) => [m.id, m.displayName || [m.firstName, m.lastName].join(" ")]));
  const teams = (raw.teams || []).map((t) => ({
    id: t.id, name: t.name || [t.location, t.nickname].filter(Boolean).join(" ") || `Team ${t.id}`, owner: members.get((t.owners || [])[0]) || "", record: t.record?.overall ? `${t.record.overall.wins}-${t.record.overall.losses}` : "",
    players: (t.roster?.entries || []).map((e) => { const a = byId.get(e.playerId), b = e.playerPoolEntry, m = mkPlayer(a || b || { id: e.playerId }, season, week, e.lineupSlotId); if (b && !m.wk) m.wk = mkPlayer(b, season, week).wk; return m; }).filter((p) => p.pos !== "?"),
  }));
  const regWeeks = raw.settings?.scheduleSettings?.matchupPeriodCount || 14;
  return { name: raw.settings?.name || "League", season, week, regWeeks, weeksLeft: Math.max(1, regWeeks - week + 1), slots, bench: counts[20] || 6, ir: counts[21] || 0, sched, teams, fa: free.map((p) => mkPlayer(p, season, week)).filter((p) => p.pos !== "?") };
}

// ---------- NFL schedule + team ratings (ESPN's public scoreboard) ----------
async function loadSchedule(season) {
  const games = {}, ok = {}, pf = {}, pa = {}, gp = {};
  await Promise.all(Array.from({ length: 18 }, (_, i) => i + 1).map(async (w) => {
    try {
      const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${season}&seasontype=2&week=${w}`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(7000) });
      if (!r.ok) return;
      const evs = ((await r.json()).events || []).filter((ev) => !ev.week || ev.week.number === w); if (evs.length < 11) return; // a real NFL week has 13-16 games; anything less isn't trustworthy
      ok[w] = true; games[w] = {};
      for (const ev of evs) {
        const c = ev.competitions?.[0], t = c?.competitors || []; if (t.length !== 2) continue;
        const ia = +t[0].team.id, ib = +t[1].team.id; games[w][ia] = ib; games[w][ib] = ia;
        if ((c.status || ev.status)?.type?.completed) {
          const sa = parseFloat(t[0].score), sb = parseFloat(t[1].score);
          if (isFinite(sa) && isFinite(sb)) { pf[ia] = (pf[ia] || 0) + sa; pa[ia] = (pa[ia] || 0) + sb; pf[ib] = (pf[ib] || 0) + sb; pa[ib] = (pa[ib] || 0) + sa; gp[ia] = (gp[ia] || 0) + 1; gp[ib] = (gp[ib] || 0) + 1; }
        }
      }
    } catch (e) { /* schedule is a bonus; the rest still works without it */ }
  }));
  if (!Object.keys(ok).length) return null;
  const ids = Object.keys(gp), tot = ids.reduce((s, i) => s + pf[i], 0), n = ids.reduce((s, i) => s + gp[i], 0), avg = n ? tot / n : 22, rate = {};
  for (const id of Object.values(NFL_ID)) { const g = gp[id] || 0; rate[id] = { off: ((pf[id] || 0) + 4 * avg) / (g + 4), def: ((pa[id] || 0) + 4 * avg) / (g + 4) }; } // shrink toward average early in the season
  const bad = {}, wk = Object.keys(ok); for (const id of Object.values(NFL_ID)) { const miss = wk.filter((w) => games[w][id] == null).length; if (wk.length >= 10 && (miss < 1 || miss > 2)) bad[id] = true; } // a team should miss exactly its bye week; otherwise don't trust the data for that team
  return { games, ok, rate, avg, bad };
}

// ---------- per-week projections: schedule, game script, byes, injuries ----------
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const NFL_ID = Object.fromEntries(Object.entries(NFL).map(([id, ab]) => [ab, +id]));
function availability(inj, k) { // chance the player suits up k weeks from now, given today's injury tag
  switch (inj) {
    case "OUT": return k < 3 ? 0 : k === 3 ? 0.7 : 1;
    case "INJURY_RESERVE": return k < 6 ? 0 : k === 6 ? 0.7 : 1;
    case "SUSPENSION": return k < 2 ? 0 : 1;
    case "DOUBTFUL": return k === 0 ? 0.15 : k === 1 ? 0.7 : 1;
    case "QUESTIONABLE": return k === 0 ? 0.75 : 1;
    case "DAY_TO_DAY": return k === 0 ? 0.7 : 1;
    default: return 1;
  }
}
function gameCtx(sched, abbr, w, pos) { // {bye, opp, mult}: how a team's opponent and expected game flow change a player's output
  const id = NFL_ID[abbr]; if (!sched || id == null || sched.bad?.[id]) return { bye: false, opp: "", mult: 1 };
  const opp = sched.games[w]?.[id];
  if (opp == null) return { bye: !!sched.ok[w], opp: "", mult: 1 };
  const T = sched.rate[id], O = sched.rate[opp]; if (!T || !O) return { bye: false, opp: NFL[opp] || "", mult: 1 };
  const expT = (T.off + O.def) / 2, expO = (O.off + T.def) / 2, margin = expT - expO, vol = clamp(1 + 0.5 * (expT / sched.avg - 1), 0.88, 1.12); // vol = how many points we expect them to score
  let m = vol;
  if (pos === "RB") m *= clamp(1 + 0.008 * margin, 0.94, 1.06);          // teams that lead run more
  else if (pos === "WR" || pos === "TE") m *= clamp(1 - 0.004 * margin, 0.96, 1.04);
  else if (pos === "QB") m *= clamp(1 - 0.004 * margin, 0.97, 1.03);      // teams that trail throw more
  else if (pos === "DST") m = clamp(1 + 0.6 * (sched.avg / Math.max(8, expO) - 1), 0.75, 1.25);
  return { bye: false, opp: NFL[opp] || "", mult: m };
}
const shares = (elig) => { // how a flex slot is usually filled, used only to size "replacement level"
  if (elig.length === 1) return { [elig[0]]: 1 };
  const w = elig.includes("QB") ? { QB: 0.6, RB: 0.13, WR: 0.13, TE: 0.14 } : { RB: 0.45, WR: 0.45, TE: 0.1 }, tot = elig.reduce((s, p) => s + (w[p] || 0), 0), o = {};
  elig.forEach((p) => { o[p] = (w[p] || 0) / tot; }); return o;
};
function prep(league) { // builds weekly projections for every player once per request
  if (league._p) return league._p;
  if ([...league.teams.flatMap((t) => t.players), ...league.fa].some((p) => !Number.isFinite(p.ppg))) throw new Error("The saved league data is from an older version. Tap Refresh ESPN data, then try again.");
  const week = league.week, reg = Math.max(week, league.regWeeks || week + league.weeksLeft - 1), ws = [];
  for (let w = week; w <= reg; w++) ws.push([w, 1]);
  for (let w = reg + 1; w <= Math.min(17, reg + 3); w++) ws.push([w, 0.5]); // fantasy playoff weeks count half: only some teams get there
  const wts = ws.map((x) => x[1]), Wsum = wts.reduce((a, b) => a + b, 0), all = [...league.teams.flatMap((t) => t.players), ...league.fa];
  for (const p of all) {
    let sum = 0, n = 0;
    p.bye = null;
    p.w = ws.map(([w], k) => {
      const c = gameCtx(league.sched, p.nfl, w, p.pos);
      if (c.bye) { if (p.bye == null) p.bye = w; return 0; }
      sum += c.mult - 1; n++;
      let base = p.ppg; if (k === 0 && p.wk > 0) base = 0.5 * p.ppg + 0.5 * p.wk; // ESPN's own number for this week, when it gave us one
      return base * c.mult * availability(p.inj, k);
    });
    p.sched = n ? Math.round((sum / n) * 100) : 0;
    p.ros = p.w.reduce((s, v, k) => s + v * wts[k], 0); p.ppw = p.ros / Wsum;
  }
  const byPos = {}; all.forEach((p) => { (byPos[p.pos] = byPos[p.pos] || []).push(p); });
  const need = {}; league.slots.forEach((s) => { const sh = shares(s.elig); for (const pos in sh) need[pos] = (need[pos] || 0) + s.n * sh[pos]; });
  const replRos = {}, replPpw = {};
  for (const pos in byPos) {
    const arr = byPos[pos].sort((a, b) => b.ros - a.ros); arr.forEach((p, i) => { p.rank = i + 1; });
    const N = Math.min(arr.length - 1, Math.max(1, Math.round(league.teams.length * ((need[pos] || 1) + 0.6)))); replRos[pos] = arr[N].ros;
    const fa = league.fa.filter((p) => p.pos === pos).sort((a, b) => b.ros - a.ros)[0]; replPpw[pos] = fa ? fa.ppw : arr[N].ppw; // best pickup actually available
  }
  const repl = [], cnt = {};
  [...league.fa].sort((a, b) => b.ros - a.ros).forEach((p) => { cnt[p.pos] = (cnt[p.pos] || 0) + 1; if (cnt[p.pos] <= TUNE.faPerPos) repl.push({ ...p, id: -p.id, free: true }); });
  const P = { ws, wts, Wsum, H: ws.length, repl, replRos, replPpw, reg };
  Object.defineProperty(league, "_p", { value: P, enumerable: false }); return P;
}

// ---------- analysis ----------
const Q = { QB: 0.06, RB: 0.11, WR: 0.08, TE: 0.07 }; // rough chance a starter at the position is missing in a given week
function lineupAgg(players, league, P, wantUsage) { // best lineup each week; returns weighted totals
  const pool = players.concat(P.repl), byPos = {}, usage = new Map(); let total = 0;
  for (let k = 0; k < P.H; k++) {
    const sorted = pool.slice().sort((a, b) => b.w[k] - a.w[k]), used = new Set();
    for (const s of league.slots) for (let i = 0; i < s.n; i++) {
      const p = sorted.find((x) => !used.has(x) && x.w[k] > 0 && s.elig.includes(x.pos));
      if (p) { used.add(p); const v = p.w[k] * P.wts[k]; total += v; byPos[p.pos] = (byPos[p.pos] || 0) + v; if (wantUsage) usage.set(p, (usage.get(p) || 0) + P.wts[k]); }
    }
  }
  return { total, byPos, usage };
}
function insurance(players, league, P, agg) { // value of backups: they step in when a starter gets hurt. Based on how good they are vs. a free pickup.
  const u = agg.usage, out = {}; let sum = 0;
  for (const pos of Object.keys(Q)) {
    const mine = players.filter((p) => p.pos === pos), S = mine.reduce((n, p) => n + (u.get(p) || 0), 0) / P.Wsum;
    const backs = mine.filter((p) => (u.get(p) || 0) / P.Wsum < 0.5).sort((a, b) => b.ppw - a.ppw), risk = S * Q[pos], pn = [risk, risk * risk * 0.7];
    out[pos] = 0; backs.slice(0, 2).forEach((b, i) => { out[pos] += Math.max(0, b.ppw - P.replPpw[pos]) * P.Wsum * pn[i]; });
    sum += out[pos];
  }
  return { sum, by: out };
}
function evalTeam(players, league, P) {
  const agg = lineupAgg(players, league, P, true), ins = insurance(players, league, P, agg);
  return { ...agg, ins: ins.sum, insBy: ins.by, value: agg.total + ins.sum };
}
const maxRoster = (league) => league.slots.reduce((n, s) => n + s.n, 0) + league.bench + league.ir;
const swap = (players, out, inn) => [...players.filter((p) => !out.includes(p)), ...inn];
const combos = (arr, pool) => { const out = arr.map((p) => [p]), top = arr.slice(0, pool); for (let i = 0; i < top.length; i++) for (let j = i + 1; j < top.length; j++) out.push([top[i], top[j]]); return out; };
const cands = (t) => t.players.filter((p) => p.pos !== "K" && p.pos !== "DST" && p.ppw > 0).sort((a, b) => b.ros - a.ros).slice(0, TUNE.candidates);
const vorp = (p, P) => Math.max(0, (p.ros - P.replRos[p.pos]) / P.Wsum); // points per week above a replacement-level player
function packageValue(list, P) { // what a package is worth on the "market": stars count for more than the sum of role players
  const v = list.map((p) => vorp(p, P) ** 1.2).sort((a, b) => b - a); return (v[0] || 0) + 0.6 * (v[1] || 0) + 0.3 * (v[2] || 0);
}
const linearValue = (list, P) => { const v = list.map((p) => vorp(p, P)).sort((a, b) => b - a); return (v[0] || 0) + 0.5 * (v[1] || 0) + 0.25 * (v[2] || 0); };
const fairTrade = (give, get, P) => { // both sides must be handing over about the same value, measured two ways
  const a = packageValue(give, P), b = packageValue(get, P), c = linearValue(give, P), d = linearValue(get, P);
  return Math.max(a, b) >= 1 && Math.min(a, b) / Math.max(a, b) >= TUNE.minFairness && Math.min(c, d) / Math.max(c, d) >= TUNE.minFairness - 0.05;
};

const rankLabel = (p) => `${p.pos}${p.rank}`;
const brief = (p) => ({ id: p.id, name: p.name, pos: p.pos, nfl: p.nfl, inj: p.inj === "ACTIVE" ? "" : p.inj, ppg: +p.ppg.toFixed(1), wk: p.wk ? +p.wk.toFixed(1) : null, ros: Math.round(p.ros), rank: rankLabel(p), bye: p.bye, sched: p.sched });
export const dealKey = (a, ga, b, gb) => [`${a}:${ga.map((p) => p.id).sort().join(".")}`, `${b}:${gb.map((p) => p.id).sort().join(".")}`].sort().join("|");

function explain(before, after, give, incoming, afterPlayers, P, league) {
  const out = [], best = Object.keys(after.byPos).map((k) => [k, ((after.byPos[k] || 0) - (before.byPos[k] || 0)) / P.Wsum]).sort((x, y) => y[1] - x[1])[0];
  if (best && best[1] >= 0.3) out.push(`Upgrades the ${best[0]} spots by about ${best[1].toFixed(1)} pts/week`);
  const sat = give.filter((p) => (before.usage.get(p) || 0) / P.Wsum < 0.4);
  if (sat.length) out.push(`${sat.map((p) => p.name).join(" and ")} ${sat.length > 1 ? "were" : "was"} mostly sitting on the bench`);
  const cnt = (pl, pos) => pl.filter((p) => p.pos === pos).length;
  for (const pos of new Set(give.map((p) => p.pos))) if (cnt(afterPlayers, pos) < league.slots.filter((s) => s.elig.includes(pos) && s.elig.length === 1).reduce((n, s) => n + s.n, 0) + 1) out.push(`Leaves only the bare minimum at ${pos}, so an injury would hurt`);
  const good = incoming.filter((p) => p.sched >= 4), tough = incoming.filter((p) => p.sched <= -4);
  if (good.length) out.push(`${good.map((p) => p.name).join(" and ")}: friendlier schedule ahead (${good.map((p) => "+" + p.sched + "%").join(", ")})`);
  if (tough.length) out.push(`Note: ${tough.map((p) => p.name).join(" and ")} faces a tougher schedule (${tough.map((p) => p.sched + "%").join(", ")})`);
  const hurt = incoming.filter((p) => p.inj && p.inj !== "ACTIVE");
  if (hurt.length) out.push(`Heads up: ${hurt.map((p) => `${p.name} is ${p.inj.replace(/_/g, " ").toLowerCase()}`).join(", ")}`);
  return out.slice(0, 4);
}

export function suggestions(league, myId) {
  const me = league.teams.find((t) => t.id === myId); if (!me) throw new Error("Pick your team first");
  const P = prep(league), cap = maxRoster(league), base = new Map(league.teams.map((t) => [t.id, evalTeam(t.players, league, P)])), found = [], min = TUNE.minGainPerWeek * P.Wsum, stats = { tried: 0, fair: 0, helpsYou: 0, tier1: 0, tier2: 0, tier3: 0, tier4: 0 };
  for (const other of league.teams) {
    if (other.id === myId) continue;
    const gives = combos(cands(me), TUNE.pairPool), gets = combos(cands(other), TUNE.pairPool), mine = [];
    for (const g of gives) for (const r of gets) {
      if (me.players.length - g.length + r.length > cap || other.players.length - r.length + g.length > cap) continue;
      stats.tried++; if (!fairTrade(g, r, P)) continue; stats.fair++; // both sides must be giving up about equal market value
      const mePlayers = swap(me.players, g, r), meNow = evalTeam(mePlayers, league, P), dMe = meNow.value - base.get(me.id).value; if (dMe < min) continue; stats.helpsYou++;
      const thPlayers = swap(other.players, r, g), thNow = evalTeam(thPlayers, league, P), dTh = thNow.value - base.get(other.id).value;
      const theyGet = packageValue(g, P), theyGive = packageValue(r, P); // market value each side receives
      let tier = 0;
      if (dTh >= min) tier = 1;                                                         // win-win: both lineups improve
      else if (dTh >= -0.5 * P.Wsum && theyGet >= 0.95 * theyGive) tier = 2;             // fair deal: roughly even for them, and they get about what they give up
      else if (dTh >= -1.5 * P.Wsum && theyGet >= 0.9 * theyGive) tier = 3;            // stretch: they dip a little, but get close to equal market value back
      else if (dTh >= -2 * P.Wsum && theyGet >= 0.9 * theyGive) tier = 4;                                          // long shot: still value-fair, but they'd have to see the bigger picture
      if (!tier) continue; stats["tier" + tier]++;
      mine.push({ other, g, r, dMe, dTh, tier, mePlayers, thPlayers, meNow, thNow, score: tier === 1 ? (2 * dMe * dTh) / (dMe + dTh) : dMe + dTh });
    }
    mine.sort((a, b) => a.tier - b.tier || b.score - a.score);
    const usedP = new Set(); let n = 0; // a few varied ideas per team, not the same player over and over
    for (const d of mine) { if (n >= TUNE.maxPerTeam) break; if ([...d.g, ...d.r].some((p) => usedP.has(p.id))) continue; [...d.g, ...d.r].forEach((p) => usedP.add(p.id)); found.push(d); n++; }
  }
  found.sort((a, b) => a.tier - b.tier || b.score - a.score);
  return { stats, deals: found.slice(0, TUNE.maxDeals).map((d) => ({
    balance: +(packageValue(d.r, P) / Math.max(0.01, packageValue(d.g, P))).toFixed(2), key: dealKey(me.id, d.g, d.other.id, d.r), team: { id: d.other.id, name: d.other.name, owner: d.other.owner, record: d.other.record }, tier: d.tier,
    give: d.g.map(brief), get: d.r.map(brief), you: { perWeek: +(d.dMe / P.Wsum).toFixed(1), ros: Math.round(d.dMe) }, them: { perWeek: +(d.dTh / P.Wsum).toFixed(1), ros: Math.round(d.dTh) },
    strength: d.tier === 2 ? "Fair deal" : d.tier === 3 ? "Stretch" : d.tier === 4 ? "Long shot" : d.score >= 30 ? "Great match" : d.score >= 15 ? "Good match" : "Fair match",
    whyYou: explain(base.get(me.id), d.meNow, d.g, d.r, d.mePlayers, P, league),
    whyThem: d.tier === 1 ? explain(base.get(d.other.id), d.thNow, d.r, d.g, d.thPlayers, P, league) : [`In my numbers their lineup changes by ${(d.dTh / P.Wsum).toFixed(1)} pts/week, but the swap is close to even in overall value (${d.g.map((p) => p.rank).join(" + ")} for ${d.r.map((p) => p.rank).join(" + ")}), which is a reasonable ask`, ...explain(base.get(d.other.id), d.thNow, d.r, d.g, d.thPlayers, P, league).slice(0, 2)],
  })) };
}

export function profile(league, teamId) {
  const P = prep(league), me = league.teams.find((t) => t.id === teamId); if (!me) throw new Error("Pick your team first");
  const ev = new Map(league.teams.map((t) => [t.id, evalTeam(t.players, league, P)])), N = league.teams.length, mine = ev.get(teamId);
  const rankOf = (f) => 1 + league.teams.filter((t) => f(ev.get(t.id)) > f(mine)).length, grade = (r) => (r <= Math.ceil(N / 3) ? "Strong" : r > Math.floor((2 * N) / 3) ? "Weak" : "Average");
  const positions = {};
  for (const pos of ["QB", "RB", "WR", "TE"]) {
    const rank = rankOf((e) => e.byPos[pos] || 0), drank = rankOf((e) => e.insBy[pos] || 0), owned = me.players.filter((p) => p.pos === pos);
    const starters = owned.filter((p) => p.slot != null && p.slot !== 20 && p.slot !== 21), bench = owned.filter((p) => !starters.includes(p)).sort((a, b) => b.ros - a.ros);
    positions[pos] = { starterPpw: +((mine.byPos[pos] || 0) / P.Wsum).toFixed(1), rank, of: N, grade: grade(rank), starters: starters.map(brief), bench: bench.map(brief), depthGrade: bench.length ? grade(drank) : "Weak", depthNote: bench.length ? "" : "No backup" };
  }
  const roster = me.players.map((p) => ({ ...brief(p), role: p.slot === 21 ? "IR" : p.slot === 20 || p.slot == null ? "Bench" : "Starter", model: (mine.usage.get(p) || 0) / P.Wsum >= 0.5 ? "Start" : "Bench" })).sort((a, b) => { const o = { Starter: 0, Bench: 1, IR: 2 }; return o[a.role] - o[b.role] || b.ros - a.ros; });
  return { team: { ppw: +(mine.total / P.Wsum).toFixed(1), ros: Math.round(mine.total), rank: rankOf((e) => e.total), of: N }, positions, roster, through: P.ws[P.ws.length - 1][0], schedule: !!league.sched };
}

// ---------- demo league (so the page works before ESPN is connected, and for testing) ----------
export function demoLeague() {
  let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const names = ["Gridiron Gurus", "Fourth & Long", "The Waiver Wire", "Blitz Krieg", "Hail Marys", "Punt Perfect", "Red Zone Rejects", "Sack Attack", "Touchdown Tony", "Bye Week Heroes"];
  const base = { QB: 19, RB: 14, WR: 14, TE: 9, K: 8, DST: 7 }, pid = { v: 100 };
  const mk = (pos, pts) => ({ id: pid.v++, name: `${pos} ${String.fromCharCode(65 + Math.floor(rnd() * 26))}. ${["Smith", "Jones", "Brown", "Davis", "Miller", "Wilson", "Moore", "Clark", "Lewis", "Hall"][Math.floor(rnd() * 10)]}`, pos, nfl: NFL[1 + Math.floor(rnd() * 30)] || "KC", inj: rnd() < 0.06 ? "QUESTIONABLE" : "ACTIVE", ppg: Math.max(2, pts + (rnd() - 0.5) * 8) });
  const teams = names.map((n, i) => {
    const shape = { QB: 2, RB: 3 + Math.floor(rnd() * 4), WR: 3 + Math.floor(rnd() * 4), TE: 2, K: 1, DST: 1 }, players = [];
    for (const [pos, c] of Object.entries(shape)) for (let k = 0; k < c; k++) players.push(mk(pos, base[pos] * (k === 0 ? 1 : 0.6)));
    return { id: i + 1, name: n, owner: `Manager ${i + 1}`, record: `${Math.floor(rnd() * 6)}-${Math.floor(rnd() * 6)}`, players };
  });
  const fa = []; for (const [pos, b] of Object.entries(base)) for (let k = 0; k < 6; k++) fa.push({ ...mk(pos, b * 0.45), inj: "ACTIVE" });
  const slots = [{ name: "QB", n: 1, elig: ["QB"] }, { name: "TE", n: 1, elig: ["TE"] }, { name: "RB", n: 2, elig: ["RB"] }, { name: "WR", n: 2, elig: ["WR"] }, { name: "DST", n: 1, elig: ["DST"] }, { name: "K", n: 1, elig: ["K"] }, { name: "FLEX", n: 1, elig: ["RB", "WR", "TE"] }].sort((a, b) => a.elig.length - b.elig.length);
  return { name: "Demo League (not your real league)", season: seasonNow(), week: 7, weeksLeft: 8, regWeeks: 14, sched: null, slots, bench: 6, ir: 1, teams, fa };
}
export const leagueBrief = (l) => ({ leagueId: FF.leagueId, name: l.name, season: l.season, week: l.week, weeksLeft: l.weeksLeft, schedule: !!l.sched, teams: l.teams.map((t) => ({ id: t.id, name: t.name, owner: t.owner, record: t.record })) });


// ---------- shared ESPN access (used by League HQ too) ----------
export const DATA_V = 3;
export async function cachedLeague(redis, force) { // ESPN data cached 10 minutes; v marks the data format so a code update never reads stale-shaped data
  const c = await redis.get("ff:league");
  if (c && c.v === DATA_V && Date.now() - c.at < 600000 && !(force && Date.now() - c.at > 60000)) return c.league;
  const league = await loadLeague(); await redis.set("ff:league", { v: DATA_V, at: Date.now(), league }, { ex: 3600 }); return league;
}
export async function espnFetch(url, label = "ESPN") {
  const headers = { Accept: "application/json" };
  if (process.env.ESPN_S2 && process.env.ESPN_SWID) headers.Cookie = `espn_s2=${process.env.ESPN_S2}; SWID=${process.env.ESPN_SWID}`;
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
  if (r.status === 401 || r.status === 403) throw new Error(headers.Cookie ? "ESPN rejected the login cookies." : "ESPN says this league is private. Add ESPN_S2 and ESPN_SWID in Vercel, then redeploy.");
  if (r.status === 404) throw new Error(`ESPN couldn't find that data (${label}).`);
  const text = await r.text();
  if (!r.ok) throw new Error(`ESPN rejected the ${label} request (error ${r.status}): ${text.replace(/\s+/g, " ").slice(0, 160)}`);
  try { return JSON.parse(text); } catch (e) { throw new Error(`ESPN sent a web page instead of data for the ${label} request.`); }
}
export const espnGet = (season, qs, label) => espnFetch(`https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}/segments/0/leagues/${FF.leagueId}${qs}`, label);
export function buildSlots(counts = {}) {
  return Object.entries(counts).filter(([k, n]) => SLOT[k] && n > 0).map(([k, n]) => ({ name: SLOT[k].length === 1 ? SLOT[k][0] : SLOT[k].join("/") === "RB/WR/TE" ? "FLEX" : SLOT[k].join("/"), n, elig: SLOT[k] })).sort((a, b) => a.elig.length - b.elig.length);
}
export function teamStrengths(league) { // projected points per week for each team's best lineup, rest of season
  const P = prep(league), m = new Map(); for (const t of league.teams) m.set(t.id, evalTeam(t.players, league, P).total / P.Wsum); return m;
}
export const POSNAME = POS;

// Connection check for the page's "Check ESPN connection" button. Never returns cookie values.
export async function diagnose() {
  const season = seasonNow(), s2 = process.env.ESPN_S2 || "", swid = process.env.ESPN_SWID || "", notes = [];
  if (!s2 || !swid) notes.push("ESPN_S2 and/or ESPN_SWID aren't visible to the site. Add them in Vercel (names must be exact, Production checked), then redeploy.");
  if (/^["']|["']$/.test(s2) || /^["']|["']$/.test(swid)) notes.push("One of the values has quote marks around it. Remove them in Vercel.");
  if (s2 !== s2.trim() || swid !== swid.trim() || /\s/.test(s2)) notes.push("One of the values has a space or line break in it. Re-paste it with nothing extra.");
  if (swid && !(swid.startsWith("{") && swid.endsWith("}"))) notes.push("SWID should start with { and end with } (curly braces included).");
  if (s2 && s2.length < 80) notes.push("espn_s2 looks too short. It's normally a very long string, so the whole value may not have been copied.");
  const headers = { Accept: "application/json" }; if (s2 && swid) headers.Cookie = `espn_s2=${s2}; SWID=${swid}`;
  const checks = [];
  for (const host of ["lm-api-reads.fantasy.espn.com", "fantasy.espn.com"]) {
    try {
      const r = await fetch(`https://${host}/apis/v3/games/ffl/seasons/${season}/segments/0/leagues/${FF.leagueId}?view=mTeam`, { headers });
      const type = (r.headers && r.headers.get && r.headers.get("content-type")) || "", text = await r.text();
      let json = false; try { JSON.parse(text); json = true; } catch (e) { /* not JSON */ }
      checks.push({ host, status: r.status, json, type: type.split(";")[0], snippet: r.ok ? (json ? "league data received" : "got a web page, not league data") : text.replace(/\s+/g, " ").slice(0, 120) });
    } catch (e) { checks.push({ host, error: e.message }); }
  }
  const api = checks[0] || {}; // the data address is what matters; the second address always answers with an ordinary web page
  if (api.status === 200 && api.json) notes.push("ESPN accepted the connection and sent league data. If the page still fails, tell me the message it shows.");
  else if (api.status === 401 || api.status === 403) notes.push(s2 && swid ? "ESPN is refusing the login. The cookies are expired or copied wrong. Copy fresh ones from a logged-in browser, or make the league public in ESPN." : "ESPN says the league is private and no login was sent. Either add the two cookies in Vercel and redeploy, or make the league viewable to the public in ESPN.");
  else if (api.status === 404) notes.push(`ESPN doesn't recognize league ${FF.leagueId} for ${season}. Check the league ID.`);
  else if (api.status === 200) notes.push("ESPN answered with a web page instead of league data. It may be blocking requests from the website's server. Tell me and we'll try another approach.");
  else if (api.error) notes.push("The site couldn't reach ESPN: " + api.error);
  try {
    const sc = await loadSchedule(season);
    if (!sc) notes.push("NFL schedule: could not load (matchups and byes will be ignored).");
    else { const wk = Object.keys(sc.ok), bad = Object.keys(sc.bad || {}).length; notes.push(`NFL schedule: ${wk.length} weeks loaded${bad ? `, ${bad} teams look inconsistent and are treated neutrally` : ", every team has exactly one bye"}.`); }
  } catch (e) { notes.push("NFL schedule check failed: " + e.message); }
  try { const L = await loadLeague(); notes.push(`Full load worked: ${L.teams.length} teams, ${L.teams.reduce((n, t) => n + t.players.length, 0)} players (${L.teams.reduce((n, t) => n + t.players.filter((p) => p.ppg > 0).length, 0)} with projections), ${L.fa.length} free agents. NFL schedule/matchups: ${L.sched ? "loaded" : "NOT available (using neutral)"}.`); } catch (e) { notes.push("Full load failed: " + e.message); }
  return { leagueId: FF.leagueId, season, s2: !!s2, swid: !!swid, notes, checks };
}
