// Rules engine for "Island Settlers" (a Catan-style game for the club). Pure logic: the server keeps the one true state.
// Everything throws an Error with a friendly message when a move isn't allowed.
export const RES = ["wood", "brick", "sheep", "wheat", "ore"];
export const DEVTYPES = ["knight", "vp", "road", "plenty", "monopoly"];
export const COLORS = ["#e0453f", "#3f86e0", "#f5c04a", "#4fb06a"];
const COST = { road: { wood: 1, brick: 1 }, settlement: { wood: 1, brick: 1, sheep: 1, wheat: 1 }, city: { wheat: 2, ore: 3 }, dev: { sheep: 1, wheat: 1, ore: 1 } };
const DEVDECK = [...Array(14).fill("knight"), ...Array(5).fill("vp"), "road", "road", "plenty", "plenty", "monopoly", "monopoly"];
const rnd = (n) => Math.floor(Math.random() * n);
const shuffle = (a) => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const total = (h) => RES.reduce((n, r) => n + h[r], 0);
const fail = (m) => { throw new Error(m); };
const note = (s, t) => { s.log.push(t); if (s.log.length > 40) s.log.shift(); };

// ---------- board geometry (fixed; built once) ----------
export const GEO = (() => {
  const hexes = [], verts = [], edges = [], vmap = new Map(), emap = new Map();
  for (let q = -2; q <= 2; q++) for (let r = -2; r <= 2; r++) {
    if (Math.abs(q + r) > 2) continue;
    const cx = Math.sqrt(3) * (q + r / 2), cy = 1.5 * r, vs = [], hi = hexes.length;
    for (let k = 0; k < 6; k++) {
      const a = (Math.PI / 180) * (60 * k - 30), x = cx + Math.cos(a), y = cy + Math.sin(a), key = Math.round(x * 1000) + "," + Math.round(y * 1000); // integer key avoids -0.000 vs 0.000 mismatches
      let id = vmap.get(key);
      if (id === undefined) { id = verts.length; vmap.set(key, id); verts.push({ x, y, adjV: [], adjE: [], hexes: [] }); }
      vs.push(id); verts[id].hexes.push(hi);
    }
    hexes.push({ x: cx, y: cy, vs });
  }
  hexes.forEach((h, hi) => h.vs.forEach((a, k) => {
    const b = h.vs[(k + 1) % 6], key = Math.min(a, b) + "-" + Math.max(a, b);
    if (!emap.has(key)) {
      const id = edges.length; emap.set(key, id); edges.push({ a: Math.min(a, b), b: Math.max(a, b), hexes: [] });
      verts[a].adjV.push(b); verts[b].adjV.push(a); verts[a].adjE.push(id); verts[b].adjE.push(id);
    }
    edges[emap.get(key)].hexes.push(hi);
  }));
  return { hexes, verts, edges };
})();
export const geoPublic = () => ({ hexes: GEO.hexes.map((h) => ({ x: h.x, y: h.y, vs: h.vs })), verts: GEO.verts.map((v) => ({ x: v.x, y: v.y })), edges: GEO.edges.map((e) => [e.a, e.b]) });
const COAST = GEO.edges.map((e, i) => i).filter((i) => GEO.edges[i].hexes.length === 1)
  .sort((x, y) => { const m = (i) => { const e = GEO.edges[i], A = GEO.verts[e.a], B = GEO.verts[e.b]; return Math.atan2((A.y + B.y) / 2, (A.x + B.x) / 2); }; return m(x) - m(y); });

// ---------- lobby ----------
const mkPlayer = (name, i) => ({ name, color: COLORS[i], res: Object.fromEntries(RES.map((r) => [r, 0])), dev: [], knights: 0, sett: [], city: [], road: [] });
export function newLobby(code, host) { return { code, host, status: "lobby", phase: "lobby", players: [mkPlayer(host, 0)], log: [], version: 1 }; }
export function joinLobby(s, name) {
  if (s.status !== "lobby") fail("That game already started");
  if (s.players.some((p) => p.name === name)) return;
  if (s.players.length >= 4) fail("That game is full");
  s.players.push(mkPlayer(name, s.players.length)); s.version++;
}
export function leaveLobby(s, name) { s.players = s.players.filter((p) => p.name === s.host || p.name !== name); s.players.forEach((p, i) => { p.color = COLORS[i]; }); s.version++; }
export function startGame(s) {
  const n = s.players.length;
  if (n < 2) fail("You need at least 2 players");
  const terr = shuffle([...Array(4).fill("wood"), ...Array(4).fill("sheep"), ...Array(4).fill("wheat"), ...Array(3).fill("brick"), ...Array(3).fill("ore"), "desert"]);
  const nums = shuffle([2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12]); let k = 0;
  s.hexes = terr.map((t) => ({ t, n: t === "desert" ? 0 : nums[k++] }));
  const types = shuffle(["any", "any", "any", "any", ...RES]);
  s.ports = types.map((type, i) => ({ e: COAST[Math.floor((i * COAST.length) / 9)], type })); // 9 ports spread around the 30 coastal edges
  s.vb = {}; s.eb = {}; s.robber = s.hexes.findIndex((h) => h.t === "desert"); s.deck = shuffle(DEVDECK);
  const order = [...Array(n).keys()];
  s.setup = { order: [...order, ...order.reverse()], i: 0, step: "settle" };
  Object.assign(s, { status: "playing", phase: "setup", turn: 0, turnNo: 1, dice: null, devPlayed: false, offer: null, largest: null, longest: null, lens: s.players.map(() => 0), version: s.version + 1 });
  note(s, "The game begins. Place your first settlement.");
}

// ---------- helpers ----------
const actor = (s) => (s.phase === "setup" ? s.setup.order[s.setup.i] : s.turn);
const afford = (p, c) => RES.every((r) => p.res[r] >= (c[r] || 0));
const pay = (p, c) => { if (!afford(p, c)) fail("You don't have enough resources"); RES.forEach((r) => { p.res[r] -= c[r] || 0; }); };
function settleOK(s, v, pi, needRoad) {
  if (s.vb[v] || GEO.verts[v].adjV.some((w) => s.vb[w])) return false;
  return !needRoad || GEO.verts[v].adjE.some((e) => s.eb[e] === pi);
}
function roadOK(s, e, pi) {
  if (e in s.eb) return false;
  const { a, b } = GEO.edges[e];
  return [a, b].some((v) => {
    const o = s.vb[v];
    if (o) return o.p === pi;
    return GEO.verts[v].adjE.some((x) => x !== e && s.eb[x] === pi);
  });
}
const portTypes = (s, pi) => { const t = new Set(); s.ports.forEach((p) => { const { a, b } = GEO.edges[p.e]; [a, b].forEach((v) => { if (s.vb[v] && s.vb[v].p === pi) t.add(p.type); }); }); return t; };
export function rates(s, pi) { const t = portTypes(s, pi), any = t.has("any") ? 3 : 4; return Object.fromEntries(RES.map((r) => [r, t.has(r) ? 2 : any])); }
function place(s, pi, v, city) {
  const p = s.players[pi];
  if (city) { p.sett = p.sett.filter((x) => x !== v); p.city.push(v); } else p.sett.push(v);
  s.vb[v] = { p: pi, c: city ? 1 : 0 };
}
function roadLen(s, pi) {
  const adj = new Map();
  for (const e of s.players[pi].road) { const { a, b } = GEO.edges[e]; [[a, b], [b, a]].forEach(([x, y]) => { if (!adj.has(x)) adj.set(x, []); adj.get(x).push([e, y]); }); }
  let best = 0;
  const dfs = (v, used, len) => {
    best = Math.max(best, len);
    for (const [e, w] of adj.get(v) || []) {
      if (used.has(e)) continue;
      used.add(e);
      if (s.vb[w] && s.vb[w].p !== pi) best = Math.max(best, len + 1); else dfs(w, used, len + 1);
      used.delete(e);
    }
  };
  for (const v of adj.keys()) dfs(v, new Set(), 0);
  return best;
}
function updateAwards(s) {
  s.lens = s.players.map((_, i) => roadLen(s, i));
  const top = Math.max(...s.lens), who = s.lens.map((l, i) => (l === top ? i : -1)).filter((i) => i >= 0);
  if (top < 5) s.longest = null; else if (who.length === 1) s.longest = who[0]; else if (!who.includes(s.longest)) s.longest = null;
  const k = s.players.map((p) => p.knights), kt = Math.max(...k), kw = k.map((x, i) => (x === kt ? i : -1)).filter((i) => i >= 0);
  if (kt < 3) s.largest = null; else if (kw.length === 1) s.largest = kw[0]; else if (!kw.includes(s.largest)) s.largest = s.largest;
}
export function vp(s, pi, hidden) {
  const p = s.players[pi];
  return p.sett.length + p.city.length * 2 + (s.longest === pi ? 2 : 0) + (s.largest === pi ? 2 : 0) + (hidden ? p.dev.filter((c) => c.t === "vp").length : 0);
}
function stealFrom(s, pi, victim) {
  const v = s.players[victim], bag = RES.flatMap((r) => Array(v.res[r]).fill(r));
  if (!bag.length) { s.phase = s.resume; return; }
  const r = bag[rnd(bag.length)]; v.res[r]--; s.players[pi].res[r]++;
  note(s, `${s.players[pi].name} stole a card from ${v.name}`); s.phase = s.resume;
}
const cleanMap = (o, keys) => { const out = {}; for (const k of keys) { const n = Math.floor(+(o && o[k]) || 0); if (n < 0 || n > 9) fail("Use amounts from 0 to 9"); if (n) out[k] = n; } return out; };
const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
const hasDev = (p, o) => Object.entries(o).every(([t, n]) => p.dev.filter((c) => c.t === t).length >= n);
const hasRes = (p, o) => Object.entries(o).every(([r, n]) => p.res[r] >= n);

// ---------- actions ----------
const ACT = {
  settle(s, pi, a) {
    if (s.phase !== "setup" || s.setup.step !== "settle") fail("Not now");
    if (!(a.id in GEO.verts) || !settleOK(s, a.id, pi, false)) fail("You can't build there");
    place(s, pi, a.id, false);
    if (s.setup.i >= s.players.length) GEO.verts[a.id].hexes.forEach((h) => { if (s.hexes[h].t !== "desert") s.players[pi].res[s.hexes[h].t]++; });
    s.setup.step = "road"; s.setup.last = a.id;
  },
  road(s, pi, a) {
    if (s.phase !== "setup" || s.setup.step !== "road") fail("Not now");
    const e = GEO.edges[a.id];
    if (!e || a.id in s.eb || (e.a !== s.setup.last && e.b !== s.setup.last)) fail("Put the road next to your new settlement");
    s.eb[a.id] = pi; s.players[pi].road.push(a.id);
    s.setup.i++; s.setup.step = "settle";
    if (s.setup.i >= s.setup.order.length) { s.phase = "roll"; s.turn = 0; s.setup = null; note(s, `${s.players[0].name} rolls first.`); }
  },
  roll(s, pi) {
    if (s.phase !== "roll") fail("You've already rolled");
    const a = 1 + rnd(6), b = 1 + rnd(6), n = a + b; s.dice = [a, b]; note(s, `${s.players[pi].name} rolled ${n}`);
    if (n === 7) {
      s.discard = {}; s.players.forEach((p, i) => { if (total(p.res) > 7) s.discard[i] = Math.floor(total(p.res) / 2); });
      s.resume = "main"; s.phase = Object.keys(s.discard).length ? "discard" : "robber";
      return;
    }
    GEO.hexes.forEach((h, hi) => {
      if (s.hexes[hi].n !== n || s.robber === hi) return;
      h.vs.forEach((v) => { const o = s.vb[v]; if (o) s.players[o.p].res[s.hexes[hi].t] += o.c ? 2 : 1; });
    });
    s.phase = "main";
  },
  discard(s, pi, a) {
    if (s.phase !== "discard" || !(pi in s.discard)) fail("Nothing to discard");
    const c = cleanMap(a.cards, RES), p = s.players[pi];
    if (sum(c) !== s.discard[pi] || !hasRes(p, c)) fail(`Discard exactly ${s.discard[pi]} cards you hold`);
    RES.forEach((r) => { p.res[r] -= c[r] || 0; }); delete s.discard[pi];
    if (!Object.keys(s.discard).length) s.phase = "robber";
  },
  moveRobber(s, pi, a) {
    if (s.phase !== "robber") fail("Not now");
    if (!(a.id in s.hexes) || a.id === s.robber) fail("Move the robber to a different tile");
    s.robber = a.id;
    const vic = [...new Set(GEO.hexes[a.id].vs.map((v) => s.vb[v]).filter((o) => o && o.p !== pi && total(s.players[o.p].res) > 0).map((o) => o.p))];
    s.victims = vic;
    if (!vic.length) s.phase = s.resume; else if (vic.length === 1) stealFrom(s, pi, vic[0]); else s.phase = "steal";
  },
  steal(s, pi, a) { if (s.phase !== "steal" || !s.victims.includes(a.target)) fail("Pick someone next to the robber"); stealFrom(s, pi, a.target); },
  build(s, pi, a) {
    const p = s.players[pi], free = s.phase === "roadbuild";
    if (s.phase !== "main" && !free) fail("You can't build now");
    if (a.kind === "road") {
      if (!(a.id in GEO.edges) || !roadOK(s, a.id, pi) || p.road.length >= 15) fail("You can't build a road there");
      if (!free) pay(p, COST.road);
      s.eb[a.id] = pi; p.road.push(a.id);
      if (free && (--s.free <= 0 || p.road.length >= 15)) s.phase = s.resume;
    } else if (free) fail("Place your free roads first");
    else if (a.kind === "settlement") {
      if (!(a.id in GEO.verts) || !settleOK(s, a.id, pi, true) || p.sett.length >= 5) fail("You can't build a settlement there");
      pay(p, COST.settlement); place(s, pi, a.id, false);
    } else if (a.kind === "city") {
      if (!p.sett.includes(a.id) || p.city.length >= 4) fail("Upgrade one of your settlements");
      pay(p, COST.city); place(s, pi, a.id, true);
    } else fail("Unknown build");
    updateAwards(s);
  },
  buyDev(s, pi) {
    if (s.phase !== "main") fail("Not now");
    if (!s.deck.length) fail("The deck is empty");
    pay(s.players[pi], COST.dev); s.players[pi].dev.push({ t: s.deck.pop(), turn: s.turnNo }); note(s, `${s.players[pi].name} bought a development card`);
  },
  playDev(s, pi, a) {
    if (s.phase !== "roll" && s.phase !== "main") fail("Not now");
    if (s.devPlayed) fail("One development card per turn");
    const p = s.players[pi], t = a.card, i = p.dev.findIndex((c) => c.t === t && c.turn < s.turnNo);
    if (!["knight", "road", "plenty", "monopoly"].includes(t) || i < 0) fail("You can't play that card right now (new cards wait a turn)");
    if (t === "plenty" && !(RES.includes(a.a) && RES.includes(a.b))) fail("Choose two resources");
    if (t === "monopoly" && !RES.includes(a.res)) fail("Choose a resource");
    p.dev.splice(i, 1); s.devPlayed = true;
    if (t === "knight") { p.knights++; s.resume = s.phase; s.phase = "robber"; note(s, `${p.name} played a Knight`); updateAwards(s); }
    else if (t === "road") { s.free = Math.min(2, 15 - p.road.length); if (s.free > 0) { s.resume = s.phase; s.phase = "roadbuild"; } note(s, `${p.name} played Road Building`); }
    else if (t === "plenty") { p.res[a.a]++; p.res[a.b]++; note(s, `${p.name} played Year of Plenty`); }
    else { let n = 0; s.players.forEach((q, j) => { if (j !== pi) { n += q.res[a.res]; q.res[a.res] = 0; } }); p.res[a.res] += n; note(s, `${p.name} played Monopoly on ${a.res} and took ${n}`); }
  },
  bank(s, pi, a) {
    if (s.phase !== "main") fail("Not now");
    const p = s.players[pi];
    if (!RES.includes(a.give) || !RES.includes(a.get) || a.give === a.get) fail("Pick two different resources");
    const rate = rates(s, pi)[a.give];
    if (p.res[a.give] < rate) fail(`You need ${rate} ${a.give} for that trade`);
    p.res[a.give] -= rate; p.res[a.get]++; note(s, `${p.name} traded ${rate} ${a.give} to the bank for 1 ${a.get}`);
  },
  offer(s, pi, a) { // players may trade resources AND development cards
    if (s.phase !== "main") fail("Not now");
    const o = { id: Date.now(), from: pi, give: cleanMap(a.give, RES), get: cleanMap(a.get, RES), devGive: cleanMap(a.devGive, DEVTYPES), devGet: cleanMap(a.devGet, DEVTYPES) };
    if (!sum(o.give) && !sum(o.devGive)) fail("Offer something");
    if (!sum(o.get) && !sum(o.devGet)) fail("Ask for something");
    const p = s.players[pi];
    if (!hasRes(p, o.give) || !hasDev(p, o.devGive)) fail("You don't have everything you're offering");
    s.offer = o; note(s, `${p.name} proposed a trade`);
  },
  cancel(s) { s.offer = null; },
  accept(s, pi) {
    const o = s.offer;
    if (!o || o.from === pi || s.phase !== "main") fail("There's no trade to accept");
    const a = s.players[o.from], b = s.players[pi];
    if (!hasRes(a, o.give) || !hasDev(a, o.devGive)) fail("They no longer have those cards");
    if (!hasRes(b, o.get) || !hasDev(b, o.devGet)) fail("You don't have what they asked for");
    const move = (from, to, types) => Object.entries(types).forEach(([t, n]) => { for (let k = 0; k < n; k++) { // give away the newest copy; the receiver can't play it until their next turn
      let bi = -1; from.dev.forEach((c, i) => { if (c.t === t && (bi < 0 || c.turn > from.dev[bi].turn)) bi = i; });
      from.dev.splice(bi, 1); to.dev.push({ t, turn: s.turnNo });
    } });
    RES.forEach((r) => { a.res[r] += (o.get[r] || 0) - (o.give[r] || 0); b.res[r] += (o.give[r] || 0) - (o.get[r] || 0); });
    move(a, b, o.devGive); move(b, a, o.devGet);
    s.offer = null; note(s, `${b.name} accepted ${a.name}'s trade`);
  },
  end(s, pi) {
    if (s.phase !== "main") fail("Roll first");
    s.turn = (s.turn + 1) % s.players.length; s.turnNo++; s.phase = "roll"; s.dice = null; s.devPlayed = false; s.offer = null;
    note(s, `${s.players[s.turn].name}'s turn`);
  },
};
const OPEN = new Set(["discard", "accept"]); // actions players may take out of turn
export function apply(s, pi, a) {
  if (s.status !== "playing") fail("The game isn't running");
  if (pi < 0) fail("You're not in this game");
  const fn = ACT[a && a.type];
  if (!fn) fail("Unknown action");
  if (!OPEN.has(a.type) && pi !== actor(s)) fail("It's not your turn");
  fn(s, pi, a);
  if (s.phase !== "setup" && s.phase !== "ended" && vp(s, s.turn, true) >= 10) { s.phase = "ended"; s.winner = s.turn; s.status = "done"; note(s, `${s.players[s.turn].name} wins!`); }
  s.version++;
}

// ---------- what each player may do / see ----------
export function legal(s, pi) {
  const L = {};
  if (s.status !== "playing" || pi < 0 || pi !== actor(s)) return L;
  const me = s.players[pi], V = GEO.verts.map((_, v) => v), E = GEO.edges.map((_, e) => e);
  if (s.phase === "setup") { if (s.setup.step === "settle") L.settle = V.filter((v) => settleOK(s, v, pi, false)); else L.road = GEO.verts[s.setup.last].adjE.filter((e) => !(e in s.eb)); }
  else if (s.phase === "roadbuild") L.road = E.filter((e) => roadOK(s, e, pi));
  else if (s.phase === "main") {
    if (afford(me, COST.road) && me.road.length < 15) L.road = E.filter((e) => roadOK(s, e, pi));
    if (afford(me, COST.settlement) && me.sett.length < 5) L.settlement = V.filter((v) => settleOK(s, v, pi, true));
    if (afford(me, COST.city) && me.city.length < 4) L.city = [...me.sett];
    L.dev = afford(me, COST.dev) && s.deck.length > 0;
  } else if (s.phase === "robber") L.robber = s.hexes.map((_, i) => i).filter((i) => i !== s.robber);
  return L;
}
export function view(s, pi) {
  const v = { code: s.code, host: s.host, status: s.status, phase: s.phase, version: s.version, you: pi, log: s.log.slice(-14),
    players: s.players.map((p, i) => ({ name: p.name, color: p.color, ...(s.status === "lobby" ? {} : { vp: vp(s, i, i === pi), cards: total(p.res), devCount: p.dev.length, knights: p.knights, roads: p.road.length, roadLen: (s.lens || [])[i] || 0, res: i === pi ? p.res : undefined, dev: i === pi ? p.dev : undefined }) })) };
  if (s.status === "lobby") return v;
  Object.assign(v, { turn: s.turn, turnNo: s.turnNo, dice: s.dice, robber: s.robber, hexes: s.hexes, ports: s.ports, vb: s.vb, eb: s.eb, offer: s.offer, victims: s.victims, discard: s.discard, free: s.free, winner: s.winner, deckLeft: s.deck.length, largest: s.largest, longest: s.longest, devPlayed: s.devPlayed, setup: s.setup ? { step: s.setup.step, actor: actor(s) } : null, legal: legal(s, pi), rates: pi >= 0 ? rates(s, pi) : null });
  if (s.status === "done") v.players.forEach((p, i) => { p.vp = vp(s, i, true); });
  return v;
}
