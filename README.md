# gtky

Gotten to Know You is a lightweight quiz game for classrooms. Participants submit a fun fact about themselves and then guess who the fact belongs to.

## Running

```bash
npm start
```

Then open `http://localhost:3000` in a browser.

## Features
- Create a room and share it via room code, short link, or QR code
- Join with your name and a single fun fact, from any device
- Host starts rounds where a random fact is shown
- Players guess which participant matches the fact (each player answers once, and can't guess their own fact)
- The correct answer is only revealed once everyone has guessed, or the host forces a reveal
- Leaderboard updates in real time
- Host actions (start/reveal/end/delete) are protected by a per-room host token
- Rooms can optionally be password protected at creation, no accounts needed

## Data retention

There's no database — everything (room codes, names, facts, scores) lives
only in the server's memory while it's running, and disappears the moment
the process restarts or a free-tier instance spins down from inactivity.
On top of that, the server automatically deletes any room 2 weeks after it
was created, whichever comes first, so nothing ever outlives that window.

Because game data can include personal details players typed in themselves,
both sides can also delete it early, before that automatic cleanup:
- **Host**: "Delete Game Data" wipes the whole room immediately.
- **Player**: "Remove My Data" on the end-of-game screen removes just that
  player's own name, fact, and score.

## Deploying (Render, free tier)

This app keeps game state in memory and pushes live updates over
Server-Sent Events, so it needs to run as a single always-on process rather
than a static site or a multi-instance serverless function.
[Render](https://render.com)'s free web service tier fits that well with no
code changes:

1. Push this repo to GitHub (already done if you're reading this there).
2. In the Render dashboard, click **New > Blueprint**, connect your GitHub
   account, and select this repo. Render will detect `render.yaml` and
   configure the service automatically (build: `npm install`, start:
   `npm start`).
3. Click **Apply** / **Create Web Service**. The first deploy takes a
   couple of minutes.
4. Once it's live, Render gives you a public URL like
   `https://gtky.onrender.com` — that's what you share with players (or
   feed into the host page's QR code, which builds itself from whatever
   host the page is served from).

Free-tier services spin down after ~15 minutes of no traffic and take
~30-50 seconds to wake back up on the next request, so open the host page
a minute before you actually start a session.
