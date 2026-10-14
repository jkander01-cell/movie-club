import { Redis } from "@upstash/redis";
const redis = new Redis({
  url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
});
// State shape: { members:[{name,email}], suggestions:{name:{title,note,picked,movie,seen:[]}}, picks:[{at,title,by,note,movie,theme,questions,when,where,ratings:{name:score}}], theme:{text,month}|null, watchlists:{name:[movie]} (private, never in the public view) }
export const load = async () => (await redis.get("club")) || { members: [], suggestions: {}, picks: [], theme: null, watchlists: {} };
export const save = (s) => redis.set("club", s);
