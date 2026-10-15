import { norm, signup, login, endSession } from "./_auth.js";
import { load, save } from "./_store.js";
export default async function handler(req, res) {
  const b = req.body || {}, u = norm(b.username);
  try {
    if (b.action === "logout") { await endSession(req); return res.json({ ok: true }); }
    if (b.action === "signup") {
      const token = await signup(u, b.password);
      const s = await load(), email = String(b.email || "").trim().slice(0, 120);
      const m = s.members.find((x) => x.name === u);
      if (m) { if (email) m.email = email; } else s.members.push({ name: u, email });
      await save(s);
      return res.json({ token });
    }
    if (b.action === "login") return res.json({ token: await login(u, b.password) });
    res.status(400).json({ error: "Unknown action" });
  } catch (e) { res.status(400).json({ error: e.message }); }
}
