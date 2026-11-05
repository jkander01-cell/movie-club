# Location Scout
A daily movie and TV trivia game. Static site, no backend, no environment variables.
- api/watch.js looks up where a movie streams (TMDB). It needs TMDB_API_KEY in Vercel; without it the page shows a JustWatch link instead.
- public/index.html holds the whole game. Questions are the BANK0 array (clue, place, lat, lon, fact, title, year, director, hideTitle); add them in multiples of 5.
- Scene #1 is 2026-11-03. Each day takes the next 5 questions from a fixed shuffle.
- Stats and streaks are stored in each visitor's browser.

## Leaderboard
`api/lb.js` stores an anonymous daily board (nickname + score) in the same Upstash Redis your other project uses. It reads `KV_REST_API_URL`/`KV_REST_API_TOKEN` or `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN`. If neither is set the board hides itself.

## Theme days
Every 7th scene starting at #4 (Fridays) has a theme (Sports Night, Chills & Thrills, ...). Edit `THEMES` in `public/index.html`.

## The globe
A clean land/ocean map with country abbreviations only (no cities or states). It is drawn on the GPU (WebGL) from a texture painted once from the country shapes in the page, and repainted sharper around the view when you zoom in. It downloads no map images, so there is nothing external to break. If WebGL is unavailable, a plain canvas version is used.

## Easy / Hard
Each day has an Easy and a Hard set (separate leaderboards). The pools are `EM0/ES0` (easy) and `HM0/HS0` (hard) in `public/index.html`.

## Fresh questions (api/daily.js)
From scene #5 on, two of each day's questions are generated and cached (shared by all players), so the game never runs out. It picks a popular (Easy) or less popular (Hard) film from TMDB, looks up its filming location on Wikidata, and has Claude write the clue. Anything that fails checks is skipped, and if anything is missing the built-in questions are used.
Needs env vars: `TMDB_API_KEY`, Upstash (`KV_REST_API_URL`/`KV_REST_API_TOKEN` or `UPSTASH_REDIS_REST_*`), and one AI key: `GEMINI_API_KEY` (free, from aistudio.google.com) or `ANTHROPIC_API_KEY` (paid). Optional: `GEMINI_MODEL`, `CLAUDE_MODEL`.
Today's set is generated when the first player opens the game. (To pre-generate each morning, add a cron for `/api/daily?cron=1` to vercel.json.)
