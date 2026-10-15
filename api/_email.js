export async function emailAll(members, subject, text) {
  const to = members.map((m) => m.email).filter(Boolean);
  if (!to.length || !process.env.RESEND_API_KEY) return false;
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: process.env.FROM_EMAIL, to, subject, text }),
  });
  return r.ok;
}
