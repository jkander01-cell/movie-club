// Sends one separate email per recipient (so addresses stay private) using Resend's batch endpoint.
// Returns { ok, count } or { ok: false, error } with the real reason, so the organizer page can show it.
export async function emailAll(members, subject, text) {
  const to = [...new Set(members.map((m) => m.email).filter(Boolean))];
  if (!to.length) return { ok: false, error: "None of the chosen people has an email address on file." };
  if (!process.env.RESEND_API_KEY || !process.env.FROM_EMAIL) return { ok: false, error: "Email isn't set up yet. Add RESEND_API_KEY and FROM_EMAIL in Vercel, then redeploy (see People & Setup)." };
  try {
    const r = await fetch("https://api.resend.com/emails/batch", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(to.map((addr) => ({ from: process.env.FROM_EMAIL, to: [addr], subject, text }))),
    });
    if (!r.ok) { let m = ""; try { const d = await r.json(); m = d.message || d.error?.message || JSON.stringify(d).slice(0, 200); } catch (e) {} return { ok: false, error: `Resend said: ${m || "error " + r.status}` }; }
    return { ok: true, count: to.length };
  } catch (e) { return { ok: false, error: "Couldn't reach the email service: " + e.message }; }
}
