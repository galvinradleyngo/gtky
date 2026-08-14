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
- Host actions (start/reveal/end) are protected by a per-room host token
