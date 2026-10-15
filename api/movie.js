import { sessionUser } from "./_auth.js";
import { REGION } from "./_config.js";
export default async function handler(req, res) {
  if (!(await sessionUser(req))) return res.status(401).json({ error: "Please log in" });
  const id = String(req.query.id || "").replace(/\D/g, "");
  if (!id || !process.env.TMDB_API_KEY) return res.json({});
  const r = await fetch(`https://api.themoviedb.org/3/movie/${id}?append_to_response=videos,watch/providers,images,credits&include_image_language=en,null`, { headers: { Authorization: `Bearer ${process.env.TMDB_API_KEY}` } });
  if (!r.ok) return res.json({});
  const d = await r.json(), us = d["watch/providers"]?.results?.[REGION] || {};
  const names = (a) => (a || []).map((x) => x.provider_name);
  const yt = (d.videos?.results || []).filter((v) => v.site === "YouTube" && ["Trailer", "Teaser"].includes(v.type)).slice(0, 3).map((v) => v.key);
  const px = (a, w, n) => (a || []).slice(0, n).map((x) => `https://image.tmdb.org/t/p/${w}${x.file_path}`);
  const q = encodeURIComponent(d.title);
  res.setHeader("Cache-Control", "s-maxage=86400");
  res.json({
    runtime: d.runtime, tagline: d.tagline, overview: d.overview, genres: (d.genres || []).map((g) => g.name),
    cast: (d.credits?.cast || []).slice(0, 6).map((c) => c.name),
    streaming: names(us.flatrate), rent: names(us.rent).slice(0, 4),
    trailer: yt[0] ? `https://www.youtube.com/watch?v=${yt[0]}` : null, trailers: yt,
    stills: [...px(d.images?.backdrops, "w500", 9), ...px(d.images?.posters, "w342", 3)],
    links: { ebert: `https://www.rogerebert.com/search?q=${q}`, x: `https://x.com/search?q=${encodeURIComponent('"' + d.title + '" movie')}&f=live`, letterboxd: `https://letterboxd.com/search/films/${q}/` },
  });
}
