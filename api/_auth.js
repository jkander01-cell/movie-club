// Accounts: passwords are salted+hashed (scrypt); sessions are random tokens stored in Redis for 30 days.
import { scrypt, randomBytes, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { redis } from "./_store.js";
const sc = promisify(scrypt);
const bad = (m) => { throw new Error(m); };
const hash = async (pw, salt) => (await sc(String(pw || ""), salt, 64)).toString("hex");
const token = (req) => (req.headers.authorization || "").replace(/^Bearer /, "");
export const norm = (u) => String(u || "").trim().toLowerCase();

function checkNew(u, pw) {
  if (!/^[a-z0-9_]{3,20}$/.test(u)) bad("Username: 3 to 20 letters, numbers, or underscores");
  if (String(pw || "").length < 8) bad("Password must be at least 8 characters");
}
async function newSession(u) {
  const t = randomBytes(24).toString("hex");
  await redis.set(`sess:${t}`, u, { ex: 60 * 60 * 24 * 30 });
  return t;
}
async function store(u, pw) {
  const salt = randomBytes(16).toString("hex");
  await redis.set(`user:${u}`, { salt, hash: await hash(pw, salt) });
}
export async function signup(u, pw) {
  checkNew(u, pw);
  if (await redis.get(`user:${u}`)) bad("That username is taken");
  await store(u, pw);
  return newSession(u);
}
export async function login(u, pw) {
  const k = `fail:${u}`;
  if ((+(await redis.get(k)) || 0) >= 8) bad("Too many attempts. Try again in 15 minutes.");
  const rec = await redis.get(`user:${u}`);
  const ok = rec && timingSafeEqual(Buffer.from(await hash(pw, rec.salt)), Buffer.from(rec.hash));
  if (!ok) { await redis.incr(k); await redis.expire(k, 900); bad("Wrong username or password"); }
  await redis.del(k);
  return newSession(u);
}
export async function setPassword(u, pw) { // organizer reset
  u = norm(u); checkNew(u, pw);
  if (!(await redis.get(`user:${u}`))) bad("No such user");
  await store(u, pw);
}
export async function sessionUser(req) { const t = token(req); return t ? await redis.get(`sess:${t}`) : null; }
export async function endSession(req) { const t = token(req); if (t) await redis.del(`sess:${t}`); }
