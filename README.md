# Movie Club: deploy in about 10 minutes

1. Put this folder in a GitHub repo (or run `npx vercel` inside it).
2. In Vercel: New Project > import the repo > Deploy.
3. Project > Storage > add **Upstash Redis** (free). It sets the KV_REST_API_* env vars for you.
4. Project > Settings > Environment Variables, add:
   - `CLUB_CODE`: a password you give your friends
   - `ADMIN_KEY`: your private organizer key (only you draw)
   - `RESEND_API_KEY`: from resend.com (free tier)
   - `FROM_EMAIL`: e.g. `Movie Club <club@yourdomain.com>` (Resend needs a verified domain to email other people)
5. Redeploy. Share the URL + club code with your friends.

Texts: Twilio can replace the `emailAll` function in `api/club.js`, but US texting needs carrier registration, so start with email.
