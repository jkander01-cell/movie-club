# Major Dude Media: how the code is organized
- `api/_config.js`: themes, discussion prompts, streaming region (edit lists here).
- `api/_store.js`: database load/save and the shape of the saved data.
- `api/_email.js`: sending email (Resend).
- `api/club.js`: all club actions. Add a function to `member` (club code) or `admin` (organizer passcode).
- `api/search.js` / `api/movie.js`: TMDB search and per-movie info (streaming, trailer, runtime).
- `public/style.css`: all styling. `public/ui.js`: shared helpers.
- `public/index.html`: member page. `public/admin.html`: organizer page (/admin).
Not built yet: Letterboxd, text reminders, comments.
