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
Not built yet: Letterboxd, text reminders, comments.
