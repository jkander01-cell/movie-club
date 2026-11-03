# Location Scout
A daily movie trivia game. Static site, no backend, no environment variables.
- public/index.html holds the whole game. Questions are the BANK0 array (question, place, lat, lon, fact); add them in multiples of 5.
- Scene #1 is 2026-11-03. Each day takes the next 5 questions from a fixed shuffle.
- Stats and streaks are stored in each visitor's browser.
