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
Not built yet: Letterboxd, text reminders, comments.
