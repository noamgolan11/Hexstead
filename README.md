# Hexstead

A free online settle-and-trade board game. Anyone with the link can open a table, invite friends with a link, and play. No accounts. You can also play practice games against bots.

## Put it online (free, about 10 minutes)

You need a free **GitHub** account (where the code lives) and a free **Render** account (which runs it).

### 1. Upload the code to GitHub

1. Sign in at https://github.com and click **New** (new repository).
2. Name it `hexstead`. Public or private both work. Click **Create repository**.
3. On the new repository page, click **uploading an existing file**.
4. Unzip `hexstead-site.zip`. Open the folder and drag **everything inside it** onto the page: the `public`, `server` and `shared` folders, plus `package.json`, `package-lock.json`, `render.yaml`, `README.md` and `.gitignore`.
   (Drag the contents, not the outer folder. `package.json` must end up at the top level of the repository.)
5. Click **Commit changes**.

### 2. Run it on Render

1. Go to https://render.com and sign up with your GitHub account.
2. Click **New** → **Blueprint**, choose your `hexstead` repository and click **Apply**.
   The included `render.yaml` sets everything up: Node, `npm install`, `npm start`, free plan.
   *(If you'd rather set it up by hand: **New** → **Web Service**, choose the repository, Build command `npm install`, Start command `npm start`, Instance type **Free**.)*
3. Wait for the first deploy to finish (a few minutes). Render gives you an address like `https://hexstead-xxxx.onrender.com`.

That's your site. Send the address to your friends.

### Playing

- Enter your name, click **Open a table**, then **Copy invite link** and send it.
- Friends open the link, type a name, and click **Take a seat**. When everyone's in, click **Start game**.
- If someone drops, they can reopen the invite link **in the same browser** to rejoin. Their seat is tied to that browser. If someone's away, the host can click **Bot plays** next to their name so the game keeps going. They take their seat back when they return.

### Good to know

- **Free plan sleeps.** Render's free plan stops the server after a stretch with no visitors. The next visit wakes it, which can take up to about a minute. Check Render's docs for the current free-plan limits.
- **Games can be lost on restarts.** The server saves tables to a file every few seconds and reloads them after a normal restart. But the free plan's disk is wiped when the server sleeps or you redeploy, so finish games in one sitting. A paid plan with a persistent disk keeps them. To use one, set the `DATA_FILE` environment variable to a path on that disk.
- **Hidden cards really are hidden.** The server only sends you your own hand and development cards.
- **Your own domain:** Render → your service → **Settings** → **Custom Domains**.
- **Other hosts:** Railway, Fly.io or any server with Node.js 18+ work too. Run `npm install` then `npm start`. The server listens on the `PORT` environment variable (default 3000).

## Run it on your own computer

Install Node.js 18 or newer from https://nodejs.org, then in this folder run:

```
npm install
npm start
```

Open http://localhost:3000. Friends on the same Wi-Fi can join through your computer's local address, for example `http://192.168.1.20:3000`.

## What's where

| Path | What it does |
| --- | --- |
| `shared/engine.js` | All the game rules. Used by both the server and the browser. |
| `shared/bot.js` | The bots. |
| `server/index.js` | Web server and WebSocket connections. |
| `server/table.js` | One table: seats, settings, chat, bots, turn timer, what each player is allowed to see. |
| `public/` | The page itself: `net.js` (connection), `ui.js` and `ui-board.js` (screens and board), `style.css`. |
