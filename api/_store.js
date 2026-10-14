import { Redis } from "@upstash/redis";
const redis = new Redis({
  url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
});
// State shape: { members:[{name,email}], suggestions:{name:{title,note,picked,movie,seen:[]}}, picks:[{at,title,by,note,movie,theme,questions,when,where,ratings:{name:score}}], theme:{text,month}|null }
export const load = async () => (await redis.get("club")) || { members: [], suggestions: {}, picks: [], theme: null };
export const save = (s) => redis.set("club", s);
