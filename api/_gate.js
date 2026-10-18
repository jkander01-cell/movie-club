// Shared check for the fantasy pages: must be logged in to the club, and (if FF_ACCESS_CODE is set) know the league code.
import { sessionUser } from "./_auth.js";
export async function gate(req, res) {
  const user = await sessionUser(req);
  if (!user) { res.status(401).json({ error: "Please log in on the club page first" }); return null; }
  const need = (process.env.FF_ACCESS_CODE || "").trim(), given = String(req.headers["x-ff-code"] || "").trim();
  if (need && given !== need) { res.status(403).json({ error: given ? "That access code isn't right. Try again." : "Enter the league access code", needCode: true, wrong: !!given }); return null; }
  return user;
}
