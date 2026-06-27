# Office Time Logger — Web App (PWA)

A simple, installable web app for logging office Enter/Exit times. Looks
and feels like a real app on your phone — own icon, full-screen, works
offline — with **zero app-store install and no build tools needed**.

## What it does
- Big **ENTER** / **EXIT** "stamp" buttons, styled like a physical punch card
- Each punch fetches the time from a **network time API** (not your phone's
  clock), so it can't be backdated by changing phone settings
- If you're offline when you tap a button, it shows a clear error and does
  **not** record a punch — a log entry is only ever created from a verified
  network time
- **Saturdays & Sundays auto-marked Holiday** — punch buttons disable
  themselves on those days
- Today's card: Enter time, Exit time, hours worked, with a little
  "ink-stamp" animation when you punch
- Recent logs list + a full **Monthly Summary** (working days, total
  hours, holiday count, day-by-day breakdown, month navigation)
- All data is stored only in your phone's browser (`localStorage`) — no
  account, no server, nothing uploaded anywhere

## How to get it on your phone (2 minutes, no computer needed if you skip step 1)

You need to host these files somewhere reachable by HTTPS — a browser
won't let a page "Add to Home Screen" as a full installable app from a
local file directly. The easiest free option:

### Option A — GitHub Pages (free, ~2 minutes)
1. Create a free GitHub account if you don't have one.
2. Create a new repository, upload all the files in this folder
   (`index.html`, `app.js`, `manifest.json`, `sw.js`, the 3 `icon-*.png`
   files) to it.
3. In the repo: **Settings → Pages → Source: Deploy from branch → main →
   / (root)** → Save.
4. After ~1 minute, GitHub gives you a URL like
   `https://yourname.github.io/your-repo/`. Open that on your phone.

### Option B — Any static host
Netlify, Vercel, Cloudflare Pages, or even Google Drive's public hosting
all work — just upload the folder as-is, no build step required.

### Then, on your phone:
- **Android (Chrome):** open the URL → tap the **⋮** menu → **"Add to Home
  screen" / "Install app"**. It installs with its own icon and opens
  full-screen, like a native app.
- **iPhone (Safari):** open the URL → tap the **Share** icon → **"Add to
  Home Screen"**.

## Files
```
webapp/
├── index.html      # app shell, layout, styling
├── app.js          # all logic: time-fetching, storage, rendering
├── manifest.json   # PWA manifest (name, icons, colors) for installability
├── sw.js           # service worker — caches the app shell for offline use
├── icon-192.png    # app icon (standard)
├── icon-512.png    # app icon (large)
└── icon-maskable-512.png  # app icon (safe-zone padded for OS icon shapes)
```

## Notes on the network time check
Phones/browsers can't do raw NTP (the protocol real network clocks use),
so this app calls a couple of free, public time APIs over HTTPS
(`timeapi.io` and `timeapi.world`) and double-checks the response looks
sane before trusting it. If both are unreachable, it tries one more
fallback before giving up and showing an error — it will never silently
fall back to your phone's own clock for a punch.

## Want changes?
A few easy follow-ups if useful:
- Export the monthly log as a CSV/PDF you can send to HR
- A PIN/passcode lock on the app
- Editable holiday list (e.g. add public holidays, not just Sat/Sun)
- Reminder notification if you forget to punch Exit
