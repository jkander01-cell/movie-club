// Fantasy trade matchmaker: loads an ESPN league and finds trades that make BOTH teams' best lineup better.
// ESPN has no official public API; this uses the same data ESPN's own site uses, so it can change without notice.
import { FF } from "./_config.js";

const POS = { 1: "QB", 2: "RB", 3: "WR", 4: "TE", 5: "K", 16: "DST" };
const SLOT = { 0: ["QB"], 2: ["RB"], 3: ["RB", "WR"], 4: ["WR"], 5: ["WR", "TE"], 6: ["TE"], 7: ["QB", "RB", "WR", "TE"], 16: ["DST"], 17: ["K"], 23: ["RB", "WR", "TE"] };
const NFL = { 1: "ATL", 2: "BUF", 3: "CHI", 4: "CIN", 5: "CLE", 6: "DAL", 7: "DEN", 8: "DET", 9: "GB", 10: "TEN", 11: "IND", 12: "KC", 13: "LV", 14: "LAR", 15: "MIA", 16: "MIN", 17: "NE", 18: "NO", 19: "NYG", 20: "NYJ", 21: "PHI", 22: "ARI", 23: "PIT", 24: "LAC", 25: "SF", 26: "SEA", 27: "TB", 28: "WSH", 29: "CAR", 30: "JAX", 33: "BAL", 34: "HOU" };
const AVAIL = { ACTIVE: 1, PROBABLE: 1, DAY_TO_DAY: 0.9, QUESTIONABLE: 0.93, DOUBTFUL: 0.55, OUT: 0.05, SUSPENSION: 0.05, INJURY_RESERVE: 0 };
const TUNE = { depthWeight: 0.06, minGainPerWeek: 0.35, candidates: 11, pairPool: 8, faPerPos: 2, maxPerTeam: 3, maxDeals: 30 };
const eff = (p) => p.pts * p.avail;
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
  const league = normalize(raw, rostered.players || [], free.players || [], season);
  if (!league.teams.some((t) => t.players.some((p) => p.pts > 0))) throw new Error("ESPN sent the rosters but no projection numbers (the season may not have projections yet).");
  return league;
}

function rate(stats, season, week) {
  const own = (stats || []).filter((s) => s.seasonId === season && s.statSplitTypeId === 0);
  const proj = own.find((s) => s.statSourceId === 1), act = own.find((s) => s.statSourceId === 0);
  const pa = proj ? proj.appliedAverage ?? (proj.appliedTotal ? proj.appliedTotal / 17 : null) : null, aa = act?.appliedAverage ?? null;
  const w = Math.min(0.5, Math.max(0, (week - 1) / 12)); // trust real results more as the season goes on
  if (pa != null && aa != null && aa > 0) return (1 - w) * pa + w * aa;
  return pa ?? aa ?? 0;
}
function mkPlayer(p, season, week, slot) {
  const pl = p.player || p, inj = pl.injuryStatus || "ACTIVE";
  return { id: p.id ?? pl.id, name: pl.fullName || "Unknown", pos: POS[pl.defaultPositionId] || "?", nfl: NFL[pl.proTeamId] || "FA", inj, avail: AVAIL[inj] ?? 1, pts: Math.max(0, rate(pl.stats, season, week)), slot };
}
function normalize(raw, rostered, free, season) {
  const week = raw.scoringPeriodId || raw.status?.currentMatchupPeriod || 1;
  const counts = raw.settings?.rosterSettings?.lineupSlotCounts || {};
  const slots = Object.entries(counts).filter(([k, n]) => SLOT[k] && n > 0).map(([k, n]) => ({ name: SLOT[k].length === 1 ? SLOT[k][0] : SLOT[k].join("/") === "RB/WR/TE" ? "FLEX" : SLOT[k].join("/"), n, elig: SLOT[k] })).sort((a, b) => a.elig.length - b.elig.length);
  const byId = new Map(rostered.map((p) => [p.id, p])), members = new Map((raw.members || []).map((m) => [m.id, m.displayName || [m.firstName, m.lastName].join(" ")]));
  const teams = (raw.teams || []).map((t) => ({
    id: t.id, name: t.name || [t.location, t.nickname].filter(Boolean).join(" ") || `Team ${t.id}`, owner: members.get((t.owners || [])[0]) || "", record: t.record?.overall ? `${t.record.overall.wins}-${t.record.overall.losses}` : "",
    players: (t.roster?.entries || []).map((e) => mkPlayer(byId.get(e.playerId) || e.playerPoolEntry || { id: e.playerId }, season, week, e.lineupSlotId)).filter((p) => p.pos !== "?"),
  }));
  const regWeeks = raw.settings?.scheduleSettings?.matchupPeriodCount || 14;
  return { name: raw.settings?.name || "League", season, week, weeksLeft: Math.max(1, regWeeks - week + 1), slots, bench: counts[20] || 6, ir: counts[21] || 0, teams, fa: free.map((p) => mkPlayer(p, season, week)).filter((p) => p.pos !== "?") };
}

// ---------- analysis ----------
function replacements(league) { // best free agents per position act as the "just pick someone up" baseline
  const out = [], by = {};
  [...league.fa].sort((a, b) => eff(b) - eff(a)).forEach((p) => { by[p.pos] = by[p.pos] || []; if (by[p.pos].length < TUNE.faPerPos) { by[p.pos].push(p); out.push({ ...p, id: -p.id, free: true }); } });
  return out;
}
function lineup(players, league) {
  const pool = [...players].sort((a, b) => eff(b) - eff(a)), used = new Set(), picks = []; let total = 0;
  for (const s of league.slots) for (let i = 0; i < s.n; i++) {
    const p = pool.find((x) => !used.has(x.id) && s.elig.includes(x.pos));
    if (p) { used.add(p.id); total += eff(p); picks.push({ slot: s.name, p }); }
  }
  return { total, picks, used };
}
function value(players, league, fa) { // weekly value: best lineup (free agents allowed) plus a little credit for useful bench depth
  const l = lineup([...players, ...fa], league);
  const bench = players.filter((p) => !l.used.has(p.id)).sort((a, b) => eff(b) - eff(a)).slice(0, league.bench).reduce((s, p) => s + eff(p), 0);
  return l.total + TUNE.depthWeight * bench;
}
const maxRoster = (league) => league.slots.reduce((n, s) => n + s.n, 0) + league.bench + league.ir;
const swap = (players, out, inn) => [...players.filter((p) => !out.includes(p)), ...inn];
const combos = (arr, pool) => { const out = arr.map((p) => [p]), top = arr.slice(0, pool); for (let i = 0; i < top.length; i++) for (let j = i + 1; j < top.length; j++) out.push([top[i], top[j]]); return out; };
const cands = (t) => t.players.filter((p) => p.pos !== "K" && p.pos !== "DST" && p.avail >= 0.3 && p.pts > 0).sort((a, b) => eff(b) - eff(a)).slice(0, TUNE.candidates);

export function profile(league, teamId) {
  const fa = replacements(league), rows = {};
  const sumBy = (t) => { const o = {}; lineup([...t.players, ...fa], league).picks.forEach(({ p }) => { if (!p.free) o[p.pos] = (o[p.pos] || 0) + eff(p); }); return o; };
  const all = league.teams.map((t) => ({ id: t.id, by: sumBy(t) })), me = league.teams.find((t) => t.id === teamId);
  ["QB", "RB", "WR", "TE"].forEach((pos) => {
    const mine = all.find((x) => x.id === teamId).by[pos] || 0, rank = 1 + all.filter((x) => (x.by[pos] || 0) > mine).length;
    const owned = me.players.filter((p) => p.pos === pos), starters = lineup([...me.players, ...fa], league).picks.filter(({ p }) => p.pos === pos && !p.free).length;
    rows[pos] = { starterPts: +mine.toFixed(1), rank, of: league.teams.length, depth: Math.max(0, owned.length - starters), grade: rank <= Math.ceil(league.teams.length / 3) ? "Strong" : rank > Math.floor((2 * league.teams.length) / 3) ? "Weak" : "Average" };
  });
  return rows;
}
function explain(team, after, give, league, fa) {
  const L0 = lineup([...team.players, ...fa], league), L1 = lineup([...after, ...fa], league);
  const sum = (L) => { const o = {}; L.picks.forEach(({ p }) => { o[p.pos] = (o[p.pos] || 0) + eff(p); }); return o; }, a = sum(L0), b = sum(L1), out = [];
  const best = Object.keys(b).map((k) => [k, (b[k] || 0) - (a[k] || 0)]).sort((x, y) => y[1] - x[1])[0];
  if (best && best[1] >= 0.3) out.push(`Upgrades your ${best[0]} spots by about ${best[1].toFixed(1)} pts/week`);
  const startedBefore = new Set(L0.picks.map(({ p }) => p.id)), gaveBench = give.filter((p) => !startedBefore.has(p.id));
  if (gaveBench.length) out.push(`${gaveBench.map((p) => p.name).join(" and ")} ${gaveBench.length > 1 ? "were" : "was"} sitting on your bench`);
  const cnt = (pl, pos) => pl.filter((p) => p.pos === pos).length;
  for (const pos of new Set(give.map((p) => p.pos))) if (cnt(after, pos) < league.slots.filter((s) => s.elig.includes(pos) && s.elig.length === 1).reduce((n, s) => n + s.n, 0) + 1) out.push(`You'd be thin at ${pos} afterward`);
  return out.slice(0, 3);
}
const brief = (p) => ({ id: p.id, name: p.name, pos: p.pos, nfl: p.nfl, inj: p.inj === "ACTIVE" ? "" : p.inj, pts: +p.pts.toFixed(1) });
export const dealKey = (a, ga, b, gb) => [`${a}:${ga.map((p) => p.id).sort().join(".")}`, `${b}:${gb.map((p) => p.id).sort().join(".")}`].sort().join("|");

export function suggestions(league, myId) {
  const me = league.teams.find((t) => t.id === myId); if (!me) throw new Error("Pick your team first");
  const fa = replacements(league), W = league.weeksLeft, cap = maxRoster(league), base = new Map(league.teams.map((t) => [t.id, value(t.players, league, fa)])), found = [];
  for (const other of league.teams) {
    if (other.id === myId) continue;
    const gives = combos(cands(me), TUNE.pairPool), gets = combos(cands(other), TUNE.pairPool), mine = [];
    for (const g of gives) for (const r of gets) {
      if (me.players.length - g.length + r.length > cap || other.players.length - r.length + g.length > cap) continue;
      const mePlayers = swap(me.players, g, r), thPlayers = swap(other.players, r, g);
      const dMe = value(mePlayers, league, fa) - base.get(me.id); if (dMe < TUNE.minGainPerWeek) continue;
      const dTh = value(thPlayers, league, fa) - base.get(other.id); if (dTh < TUNE.minGainPerWeek) continue;
      mine.push({ other, g, r, dMe, dTh, mePlayers, thPlayers, score: (2 * dMe * dTh) / (dMe + dTh) });
    }
    mine.sort((a, b) => b.score - a.score);
    const usedP = new Set(); let n = 0; // a few varied ideas per team, not the same player over and over
    for (const d of mine) { if (n >= TUNE.maxPerTeam) break; if ([...d.g, ...d.r].some((p) => usedP.has(p.id))) continue; [...d.g, ...d.r].forEach((p) => usedP.add(p.id)); found.push(d); n++; }
  }
  found.sort((a, b) => b.score - a.score);
  return found.slice(0, TUNE.maxDeals).map((d) => ({
    key: dealKey(me.id, d.g, d.other.id, d.r), team: { id: d.other.id, name: d.other.name, owner: d.other.owner, record: d.other.record },
    give: d.g.map(brief), get: d.r.map(brief), you: { perWeek: +d.dMe.toFixed(1), ros: Math.round(d.dMe * W) }, them: { perWeek: +d.dTh.toFixed(1), ros: Math.round(d.dTh * W) },
    strength: d.score * W >= 30 ? "Great" : d.score * W >= 15 ? "Good" : "Fair",
    whyYou: explain(me, d.mePlayers, d.g, league, fa), whyThem: explain(d.other, d.thPlayers, d.r, league, fa),
  }));
}

// ---------- demo league (so the page works before ESPN is connected, and for testing) ----------
export function demoLeague() {
  let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const names = ["Gridiron Gurus", "Fourth & Long", "The Waiver Wire", "Blitz Krieg", "Hail Marys", "Punt Perfect", "Red Zone Rejects", "Sack Attack", "Touchdown Tony", "Bye Week Heroes"];
  const base = { QB: 19, RB: 14, WR: 14, TE: 9, K: 8, DST: 7 }, pid = { v: 100 };
  const mk = (pos, pts) => ({ id: pid.v++, name: `${pos} ${String.fromCharCode(65 + Math.floor(rnd() * 26))}. ${["Smith", "Jones", "Brown", "Davis", "Miller", "Wilson", "Moore", "Clark", "Lewis", "Hall"][Math.floor(rnd() * 10)]}`, pos, nfl: NFL[1 + Math.floor(rnd() * 30)] || "KC", inj: rnd() < 0.06 ? "QUESTIONABLE" : "ACTIVE", avail: 1, pts: Math.max(2, pts + (rnd() - 0.5) * 8) });
  const teams = names.map((n, i) => {
    const shape = { QB: 2, RB: 3 + Math.floor(rnd() * 4), WR: 3 + Math.floor(rnd() * 4), TE: 2, K: 1, DST: 1 }, players = [];
    for (const [pos, c] of Object.entries(shape)) for (let k = 0; k < c; k++) players.push(mk(pos, base[pos] * (k === 0 ? 1 : 0.6)));
    players.forEach((p) => { p.avail = AVAIL[p.inj]; });
    return { id: i + 1, name: n, owner: `Manager ${i + 1}`, record: `${Math.floor(rnd() * 6)}-${Math.floor(rnd() * 6)}`, players };
  });
  const fa = []; for (const [pos, b] of Object.entries(base)) for (let k = 0; k < 6; k++) fa.push({ ...mk(pos, b * 0.45), inj: "ACTIVE" });
  const slots = [{ name: "QB", n: 1, elig: ["QB"] }, { name: "TE", n: 1, elig: ["TE"] }, { name: "RB", n: 2, elig: ["RB"] }, { name: "WR", n: 2, elig: ["WR"] }, { name: "DST", n: 1, elig: ["DST"] }, { name: "K", n: 1, elig: ["K"] }, { name: "FLEX", n: 1, elig: ["RB", "WR", "TE"] }].sort((a, b) => a.elig.length - b.elig.length);
  return { name: "Demo League (not your real league)", season: seasonNow(), week: 7, weeksLeft: 8, slots, bench: 6, ir: 1, teams, fa };
}
export const leagueBrief = (l) => ({ leagueId: FF.leagueId, name: l.name, season: l.season, week: l.week, weeksLeft: l.weeksLeft, teams: l.teams.map((t) => ({ id: t.id, name: t.name, owner: t.owner, record: t.record })) });

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
  try { const L = await loadLeague(); notes.push(`Full load worked: ${L.teams.length} teams, ${L.teams.reduce((n, t) => n + t.players.length, 0)} players (${L.teams.reduce((n, t) => n + t.players.filter((p) => p.pts > 0).length, 0)} with projections), ${L.fa.length} free agents.`); } catch (e) { notes.push("Full load failed: " + e.message); }
  return { leagueId: FF.leagueId, season, s2: !!s2, swid: !!swid, notes, checks };
}
