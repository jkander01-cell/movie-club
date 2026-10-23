# Major Dude Media: how the code is organized
- `api/_config.js`: themes, discussion prompts, streaming region (edit lists here).
- `api/_store.js`: database load/save and the shape of the saved data.
- `api/_email.js`: sending email (Resend).
- `api/club.js`: all club actions. Add a function to `member` (club code) or `admin` (organizer passcode).
- `api/search.js` / `api/movie.js`: TMDB search and per-movie info (streaming, trailer, runtime).
- `public/style.css`: all styling. `public/ui.js`: shared helpers.
- `public/index.html`: member page. `public/admin.html`: organizer page (/admin).
Watchlists: per member (`watchlists` in state); members can see each other's via the `lists` action. Survey questions live in `_config.js` (SURVEY); answers are stored on each pick. Recipes are written by the organizer.
Accounts: `api/_auth.js` (hashing, sessions) and `api/auth.js` (signup/login/logout). Members act as the logged-in username; the organizer uses ADMIN_KEY and can reset passwords from /admin.
Schedule: `SCHEDULE` in `_config.js` (weekday, which weeks, time, draw lead time, timezone); `_schedule.js` computes the dates. A draw gets the next screening date that has no pick. The "How the club works" text on the homepage is written by hand, so update it if the schedule changes.
Recipes: `api/recipes.js` suggests 3 dishes for the organizer. Free mode (default) picks dishes from TheMealDB by the film's country; if ANTHROPIC_API_KEY is set in Vercel it asks Claude to tailor them to the plot instead. Hearts: `heart` action, stored as `hearts` on each suggestion.
Suggestions: keyed by id with an `by` author; each member can have MAX_SUGGESTIONS (in `_config.js`) active at once. The draw gives each member the same total chance regardless of how many movies they entered.
Reminders: `api/cron.js` runs daily (schedule in `vercel.json`); it emails the day before a screening and nudges unanswered surveys 3 days after. Each is sent once (flags in `pick.remind`). Optional CRON_SECRET env var locks it down.
Front end: views are home/pool/lists/past/detail (see setView in index.html); `toast()` in ui.js replaces alerts.
Schedule overrides: `s.sched` {skip, extra} set from /admin; `effective()` in `_schedule.js` applies them. A suggestion slot stays used until its movie is watched (`watched()` in club.js). Movies not on a standard streamer (`STANDARD_STREAMERS`) get a note at suggest time and lower draw odds (`LIMITED_ODDS`).
Picks go draft -> published (members see it) -> announced (email); statuses live on each pick (`status`, `publishedAt`, `notifiedAt`). Members never receive draft picks (see `view` in club.js). Admin page is tabbed: Screenings, Schedule & Theme, Pool, People & Setup.
Ratings: any movie can be rated (`ratemovie`, stored in `myRatings`; also updates the matching club pick). Favorites: 4 per member (`fav`/`favs`, `favorites` in state). The movie page puts "Rate It & After the Credits" right under the movie info.
Email: `_email.js` returns {ok, count} or {ok:false, error} with Resend's real message. The announcement lets the organizer choose recipients (`notify` with `to`/`extra`). `api/emailtest.js` backs the test button on People & Setup.
Fantasy Trade Match (/trades): `api/_ff.js` loads the ESPN league (league ID in `_config.js`; private leagues need ESPN_S2 + ESPN_SWID) plus NFL schedule/scores from ESPN's public scoreboard. `prep()` turns each player's per-game projection into week-by-week points (byes, injury tags, opponent strength, game script). `evalTeam()` finds the best lineup every remaining week and adds a backup/injury insurance value; `fairTrade()` requires both sides to give up similar market value (points above replacement level); trades must improve BOTH lineups. Tuning numbers are in TUNE and the multipliers in `gameCtx()`/`availability()`. `api/ff.js` is the endpoint (club login required, optional FF_ACCESS_CODE, ESPN data cached 10 minutes, swipes in Redis). Keeper costs are not modeled yet.
Not built yet: Letterboxd, text reminders, comments.


League HQ (/league): `api/_hq.js` loads scores/schedule (and box scores for finished weeks, cached forever in Redis `hq:box:<season>`) from ESPN, then computes standings, all-play luck, power rankings, Monte Carlo playoff odds (`simulate`), weekly recap awards (`recap`) and history (`loadHistory`, best effort). `api/hq.js` is the endpoint (same login + FF_ACCESS_CODE gate as trades, via `_gate.js`); pick'em picks live in Redis `hq:picks:<season>`. `api/cron.js` emails the recap on Tuesday mornings (Eastern) once all of a week's games are final; set HQ_EMAIL=off in Vercel to stop that. Shared styles: `public/ff.css`.

## Movie club v2 (RSVP, discussion, stats, vote, Showtime)
- Pick fields added: `rsvp {name: live|solo|no}`, `seenBy [names]`, `thread [{id,by,text,at}]`, `reacts {emoji:n}`, `feed [{by,e,at}]`. State field `vote {open,month,options,votes{name:idx}}`.
- Discussion is spoiler-safe: `shape()` in api/club.js strips `thread` unless the member marked the movie seen, rated it, or saved the survey; `post` enforces it server-side.
- api/_stats.js: club stats, wrapped (year filter) and taste-match (pairs with 3+ shared ratings across ALL rated movies).
- Member actions: rsvp, seenpick, post, delpost, react, vote, stats, watchedcheck, recs (TMDB recommendations from your 8+ ratings). Admin: openvote (optional email), closevote.
- Showtime tab: countdown uses the club timezone (tz in the view); polls /api/club every 8s for reactions.
- cron: RSVP nudge within 3 days and the day-before reminder go only to members with no RSVP.
