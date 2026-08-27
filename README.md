# gtky

Gotten to Know You is a lightweight, Kahoot-style icebreaker quiz. Everyone
submits a fun fact about themselves, then races through a personal quiz —
guessing who each *other* fact belongs to — before a shared timer runs out.

## 🎮 Play Now

The live game runs on Render — no install needed:

- **[Create a game](https://gtky-u0y9.onrender.com/)** (host)
- **[Join a game](https://gtky-u0y9.onrender.com/player.html)** (player)

## Running

```bash
npm start
```

Then open `http://localhost:3000` in a browser.

## Features
- Create a room and share it via room code, short link, or QR code
- Name the room, optionally password protect it, set the round timer, and
  toggle background music — no accounts needed
- Every room gets a random icon as its logo, shown to host and players alike
- Join with a name and a single fun fact, from any device
- Once the host starts the game, each player gets their own shuffled quiz —
  every other player's fact, but never their own — and answers at their own
  pace against a shared countdown
- Instant private feedback after every guess (right/wrong + the real answer)
- The game ends when the timer runs out or everyone finishes, whichever
  comes first, or the host can end it early
- An Olympics-style podium reveals the top 3; the host can tap any of them
  to see exactly what they guessed on each question
- Live leaderboard throughout
- Host actions (start/end/delete) are protected by a per-room host token
- The host's browser remembers rooms it created (a small local "library"),
  so reopening host.html offers to resume a saved game — password required
  if the room has one — instead of always starting fresh

## Data retention

There's no database — everything lives only in the server's memory while
it's running, and disappears the moment the process restarts or a free-tier
instance spins down from inactivity. On top of that, the server automatically
deletes any room 2 weeks after it was created, whichever comes first, so
nothing ever outlives that window.

Beyond that backstop, participants' fun facts are personal, so they're
erased from the server immediately when a game ends — win, lose, or the host
stops it early. Names and scores stick around only long enough to show the
final leaderboard/podium (and let the host review who guessed what), and can
be wiped early too:
- **Host**: "Delete Game Data" wipes the whole room immediately.
- **Player**: "Remove My Data" on the end-of-game screen removes just that
  player's own name and score.

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

## This repo's front door

GitHub can't run `server.js` itself (Pages only serves static files, and
this app needs a persistent process for in-memory state and Server-Sent
Events), so the "Play Now" links above are the front door — this README is
what visitors to the repo page see first. To also surface a clickable link
in the repo's sidebar, set repo **Settings → General → Website** to
`https://gtky-u0y9.onrender.com/`. That's a GitHub UI step, not something a
commit can do.
