# Location Scout
A daily movie trivia game. Static site, no backend, no environment variables.
- api/watch.js looks up where a movie streams (TMDB). It needs TMDB_API_KEY in Vercel; without it the page shows a JustWatch link instead.
- public/index.html holds the whole game. Questions are the BANK0 array (clue, place, lat, lon, fact, title, year, director, hideTitle); add them in multiples of 5.
- Scene #1 is 2026-11-03. Each day takes the next 5 questions from a fixed shuffle.
- Stats and streaks are stored in each visitor's browser.
