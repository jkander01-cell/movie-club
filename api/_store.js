import { Redis } from "@upstash/redis";
export const redis = new Redis({
  url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
});
// State shape: { members:[{name,email}], suggestions:{id:{id,by,title,note,picked,movie,seen:[]}}, picks:[{survey:{name:answers},recipe:{title,text},at,title,by,note,movie,theme,questions,when,where,ratings:{name:score}}], theme:{text,month}|null, watchlists:{name:[movie]} (private, never in the public view) }
export const load = async () => {
  const s = (await redis.get("club")) || { members: [], suggestions: {}, picks: [], theme: null, watchlists: {} };
  for (const [k, v] of Object.entries(s.suggestions)) { v.id = v.id || k; v.by = v.by || k; } // upgrade old name-keyed entries
  return s;
};
export const save = (s) => redis.set("club", s);
