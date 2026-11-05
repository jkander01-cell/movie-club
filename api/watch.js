// Looks up a movie or TV show (type=tv) on TMDB and returns where it streams in the US. Needs TMDB_API_KEY in Vercel.
// Returns {} when the key is missing or nothing is found; the page then shows a JustWatch link instead.
export default async function handler(req, res) {
  const key = process.env.TMDB_API_KEY;
  const title = String(req.query.title || "").slice(0, 120).trim();
  const year = String(req.query.year || "").replace(/\D/g, "").slice(0, 4);
  const tv = req.query.type === "tv", kind = tv ? "tv" : "movie";
  if (!key || !title) return res.json({});
  const get = async (path) => { const r = await fetch(`https://api.themoviedb.org/3${path}`, { headers: { Authorization: `Bearer ${key}` } }); if (!r.ok) throw new Error("TMDB " + r.status); return r.json(); };
  try {
    const q = encodeURIComponent(title);
    let m = ((await get(`/search/${kind}?include_adult=false&query=${q}${year ? (tv ? "&first_air_date_year=" : "&year=") + year : ""}`)).results || [])[0];
    if (!m && year) m = ((await get(`/search/${kind}?include_adult=false&query=${q}`)).results || [])[0];
    if (!m) return res.json({});
    const us = ((await get(`/${kind}/${m.id}/watch/providers`)).results || {}).US || {};
    const names = (a) => (a || []).map((x) => x.provider_name);
    res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate=604800");
    res.json({ id: m.id, poster: m.poster_path ? `https://image.tmdb.org/t/p/w185${m.poster_path}` : null, stream: names(us.flatrate), rent: names(us.rent), buy: names(us.buy) });
  } catch (e) { res.json({}); }
}
