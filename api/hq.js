// League HQ endpoint: standings/power rankings, playoff odds, weekly recap, pick'em, history.
import { redis } from "./_store.js";
import { gate } from "./_gate.js";
import { cachedLeague, teamStrengths } from "./_ff.js";
import { loadHQ, loadHistory, overview, simulate, recap, history, results, matchups } from "./_hq.js";

async function strengths(force) { try { return teamStrengths(await cachedLeague(redis, force)); } catch (e) { return null; } } // projections are a bonus; HQ still works without them
const locked = (g, data) => g.done || g.hp > 0 || g.ap > 0 || g.week < data.week;

export default async function handler(req, res) {
  const user = await gate(req, res); if (!user) return;
  const q = req.method === "GET" ? req.query : req.body || {};
  try {
    const force = !!q.refresh, data = await loadHQ(redis, force);
    switch (q.action) {
      case "matchups": return res.json(matchups(data, await strengths(force)));
      case "overview": return res.json(overview(data, await strengths(force)));
      case "odds": { const st = await strengths(force); const key = `hq:odds:${data.season}:${data.week}:${results(data).length}`, c = force ? null : await redis.get(key); if (c) return res.json(c); const out = { ...simulate(data, st), week: data.week, season: data.season }; await redis.set(key, out, { ex: 3600 }); return res.json(out); }
      case "recap": return res.json({ ...recap(data, q.week), league: data.name });
      case "history": { const hist = await loadHistory(redis, force), me = data.teams.find((t) => t.id === +q.team); return res.json(history(hist, data, me?.ownerId || "")); }
      case "picks": {
        const all = (await redis.get(`hq:picks:${data.season}`)) || {}, wk = data.week;
        const games = data.games.filter((g) => g.week === wk && !g.playoff).map((g) => ({ id: g.id, home: g.home, away: g.away, homeName: data.teams.find((t) => t.id === g.home)?.name, awayName: data.teams.find((t) => t.id === g.away)?.name, locked: locked(g, data), mine: all[wk]?.[user]?.[g.id] ?? null, tally: Object.values(all[wk] || {}).reduce((o, p) => { const v = p[g.id]; if (v != null) o[v] = (o[v] || 0) + 1; return o; }, {}) }));
        const board = {}; // season leaderboard: right picks on finished games
        for (const [w, byUser] of Object.entries(all)) for (const [u, pk] of Object.entries(byUser)) for (const [gid, t] of Object.entries(pk)) {
          const g = data.games.find((x) => String(x.id) === gid && x.week === +w); if (!g || !g.done || g.winner === "TIE") continue;
          const b = (board[u] = board[u] || { user: u, right: 0, made: 0 }); b.made++; if ((g.winner === "HOME" ? g.home : g.away) === t) b.right++;
        }
        return res.json({ week: wk, games, board: Object.values(board).sort((a, b) => b.right - a.right || a.made - b.made), me: user });
      }
      case "pick": {
        const g = data.games.find((x) => x.id === +q.game && x.week === data.week); if (!g) throw new Error("That game isn't in this week's matchups.");
        if (locked(g, data)) throw new Error("That matchup has started, so picks are locked.");
        if (![g.home, g.away].includes(+q.winner)) throw new Error("Pick one of the two teams.");
        const all = (await redis.get(`hq:picks:${data.season}`)) || {}; all[data.week] = all[data.week] || {}; all[data.week][user] = { ...(all[data.week][user] || {}), [g.id]: +q.winner };
        await redis.set(`hq:picks:${data.season}`, all); return res.json({ ok: true });
      }
      case "diagnose": {
        const wk = Object.keys(data.box || {}).length, done = new Set(results(data).map((r) => r.week)).size;
        return res.json({ notes: [`Season ${data.season}, week ${data.week}. ${data.teams.length} teams, ${data.games.length} scheduled matchups, ${done} weeks finished.`, wk ? `Bench and lineup details loaded for ${wk} of ${done} finished weeks.` : "Bench and lineup details did NOT load (the recap still works without the bench awards).", `Playoff spots: ${data.playoffTeams}.`] });
      }
      default: throw new Error("Unknown action");
    }
  } catch (e) { res.status(502).json({ error: e.message }); }
}
