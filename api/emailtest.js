// Organizer-only: sends a test email and reports the exact reason if it fails.
import { emailAll } from "./_email.js";
export default async function handler(req, res) {
  const b = req.body || {};
  if (!process.env.ADMIN_KEY || b.adminKey !== process.env.ADMIN_KEY) return res.status(403).json({ error: "Wrong organizer passcode" });
  const to = String(b.to || "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return res.status(400).json({ error: "Enter a valid email address to send the test to." });
  const info = `RESEND_API_KEY: ${process.env.RESEND_API_KEY ? "found" : "MISSING"}. FROM_EMAIL: ${process.env.FROM_EMAIL ? process.env.FROM_EMAIL : "MISSING"}.`;
  const r = await emailAll([{ email: to }], "Test from Major Dude Media", "If you can read this, announcements and reminders will work.");
  res.json({ ok: r.ok, message: `${info} ${r.ok ? `Test email sent to ${to}. Check the inbox and spam folder.` : r.error}` });
}
