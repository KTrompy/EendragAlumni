# Eendrag Alumni Hub

A community platform for Eendrag alumni: accounts, a house feed, an alumni directory, and 1:1 realtime messaging. Built with React (Vite) + Supabase.

Karakter · Styl · Trots — sedert 1961.

## What's inside

- **Auth** — email/password signup and login (Supabase Auth)
- **Approval gate** — anyone can sign up, but posting and messaging only unlock after you mark them `approved` (so randoms can't infiltrate the house)
- **Feed** — text posts, live-updating, authors can delete their own
- **Directory** — searchable alumni list (name, year, section, city, occupation)
- **Messages** — 1:1 DMs with realtime delivery
- **Profiles** — self-editable directory entries

## Setup (once, ~20 minutes)

### 1. Create the Supabase project
1. Go to [supabase.com](https://supabase.com), sign up (free), and create a new project. Pick a region close to South Africa (eu-west is usually fine).
2. Save the database password somewhere safe (you rarely need it, but don't lose it).

### 2. Run the schema
1. In the Supabase dashboard, open **SQL Editor**.
2. Paste the entire contents of `schema.sql` and run it. This creates all tables, security policies, and the realtime setup.

### 3. Configure auth
1. Go to **Authentication → Providers** and make sure **Email** is enabled.
2. Under **Authentication → URL Configuration**, you'll later add your live site URL so confirmation emails redirect correctly. For now the localhost default is fine.

### 4. Wire up the app
1. In the dashboard, go to **Settings → API** and copy the **Project URL** and **anon public** key.
2. In this folder: copy `.env.example` to `.env` and paste those two values in.
3. Install and run:
   ```bash
   npm install
   npm run dev
   ```
4. Open the printed localhost URL. Sign up with your own email, confirm via the email link, and sign in.

### 5. Approve members (this is your admin job)
New signups can browse but can't post or message until approved:
1. In Supabase, open **Table Editor → profiles**.
2. Find the person's row, tick the `approved` checkbox, save.

Approve yourself first. Later, if this gets tedious at scale, we can build a small admin page or an invite-code system instead.

## Deploy to Vercel (free)

1. Push this folder to a GitHub repo.
2. Go to [vercel.com](https://vercel.com), sign in with GitHub, click **Add New → Project**, and import the repo. Vercel auto-detects Vite.
3. In the project's **Environment Variables**, add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` with the same values as your `.env`.
4. Deploy. You'll get a `something.vercel.app` URL immediately.
5. Back in Supabase: **Authentication → URL Configuration → Site URL** — set it to your Vercel URL so email confirmation links point to the live site.
6. Optional: buy a domain (e.g. `eendragalumni.co.za`) and add it under Vercel → Settings → Domains.

## Security notes

- The `anon` key in the frontend is **meant to be public** — all real protection lives in the Row Level Security policies in `schema.sql`. Never put the `service_role` key in frontend code.
- Users can't approve themselves (the update policy blocks changing `approved`).
- Messages are only readable by their two participants; posts are readable by any signed-in member.

## Ideas for v2

- Admin page for approving members without opening Supabase
- Event calendar (reunions, golf days)
- Profile photos (Supabase Storage)
- Email digests of new posts
- Year-group channels
