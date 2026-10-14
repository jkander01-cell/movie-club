import { REGION } from "./_config.js";
export default async function handler(req, res) {
  const id = String(req.query.id || "").replace(/\D/g, "");
  if (!id || !process.env.TMDB_API_KEY) return res.json({});
  const r = await fetch(`https://api.themoviedb.org/3/movie/${id}?append_to_response=videos,watch/providers`, { headers: { Authorization: `Bearer ${process.env.TMDB_API_KEY}` } });
  if (!r.ok) return res.json({});
  const d = await r.json(), us = d["watch/providers"]?.results?.[REGION] || {};
  const names = (a) => (a || []).map((x) => x.provider_name);
  const t = (d.videos?.results || []).find((v) => v.site === "YouTube" && v.type === "Trailer");
  res.setHeader("Cache-Control", "s-maxage=86400");
  res.json({ runtime: d.runtime, streaming: names(us.flatrate), rent: names(us.rent).slice(0, 4), trailer: t ? `https://www.youtube.com/watch?v=${t.key}` : null });
}
