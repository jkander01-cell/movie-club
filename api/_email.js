// Sends one separate email per recipient (so addresses stay private) using Resend's batch endpoint.
export async function emailAll(members, subject, text) {
  const to = members.map((m) => m.email).filter(Boolean);
  if (!to.length || !process.env.RESEND_API_KEY) return false;
  const r = await fetch("https://api.resend.com/emails/batch", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(to.map((addr) => ({ from: process.env.FROM_EMAIL, to: [addr], subject, text }))),
  });
  return r.ok;
}
