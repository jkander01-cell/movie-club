// Edit these lists to change themes and discussion prompts. No other code needs to change.
export const THEMES = ["Dress as a character","Themed snacks only","Predict the ending before we start","Rate it before and after discussion","Hot take night: one unpopular opinion each","Watch with subtitles on","Bring a snack from the movie's country","Cast the sequel: who would you hire?"];
export const QUESTIONS = ["What was the best scene, and why?","Which character would you want as a friend?","What would you change about the ending?","What did the movie do better than most in its genre?","Who should have won an award for this?","Would you rewatch it? Under what circumstances?","What did you notice that others might have missed?"];
export const REGION = "US"; // streaming availability region (TMDB country code)
// After-the-credits questionnaire. type: "yn" | "choice" (needs options) | "text". Edit freely.
export const SURVEY = [
  { id: "again", type: "yn", q: "Would you watch it again?" },
  { id: "felt", type: "yn", q: "Did it make you feel something you didn't expect?" },
  { id: "rough", type: "yn", q: "Would you recommend it to someone having a rough week?" },
  { id: "vibe", type: "choice", q: "Which word fits it best?", options: ["Cozy", "Thrilling", "Heartbreaking", "Hilarious", "Mind-bending"] },
  { id: "end", type: "choice", q: "How did the ending land?", options: ["Perfect", "Earned it", "Rushed", "Should've stopped sooner", "Still thinking about it"] },
  { id: "best", type: "choice", q: "The best part was...", options: ["The story", "The acting", "The look and sound", "The dialogue", "The company"] },
  { id: "moment", type: "text", q: "Which line, scene, or moment is staying with you?" },
  { id: "life", type: "text", q: "What did this movie make you think about in your own life?" },
];
// Screening schedule: the 1st and 3rd Sunday of each month. weekday: 0=Sunday. The draw happens drawDaysBefore days ahead.
export const SCHEDULE = { weekday: 0, nth: [1, 3], time: "19:00", drawDaysBefore: 7, timezone: "America/New_York" };
export const RECIPE_MODEL = "claude-haiku-5-5"; // model used for pairing-recipe suggestions
export const MAX_SUGGESTIONS = 2; // active (not yet drawn) suggestions each member can have
// A movie counts as "on a standard streamer" if a subscription service matching this is listed for it.
export const STANDARD_STREAMERS = /netflix|hulu|disney|peacock|paramount|^max$|hbo|apple tv/i;
export const LIMITED_ODDS = 0.5; // draw odds multiplier for movies that aren't on a standard streamer
// Fantasy trade matchmaker: your ESPN league. Private leagues also need ESPN_S2 and ESPN_SWID set in Vercel.
export const FF = { leagueId: "626089", topHalf: true }; // topHalf: every week also gives a win (top half of scoring) or loss (bottom half), on top of the head-to-head result
