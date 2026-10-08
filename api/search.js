export default async function handler(req, res) {
  const q = String(req.query.q || "").trim();
  if (q.length < 2) return res.json([]);
  if (!process.env.TMDB_API_KEY) return res.status(500).json({ error: "TMDB_API_KEY not set" });
  const r = await fetch(
    `https://api.themoviedb.org/3/search/movie?include_adult=false&query=${encodeURIComponent(q)}`,
    { headers: { Authorization: `Bearer ${process.env.TMDB_API_KEY}` } }
  );
  if (!r.ok) return res.status(502).json({ error: "Movie search failed" });
  const d = await r.json();
  res.json((d.results || []).slice(0, 6).map((m) => ({
    id: m.id,
    title: m.title,
    year: (m.release_date || "").slice(0, 4),
    poster: m.poster_path ? `https://image.tmdb.org/t/p/w185${m.poster_path}` : null,
    overview: (m.overview || "").slice(0, 280),
  })));
}
