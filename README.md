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
- **Day types**, each shown with its own colored badge:
  - **Weekend** — Saturdays & Sundays, detected automatically
  - **National Holiday** — pre-filled with the 2026 holiday list (Republic
    Day, Holi, Id-ul-Fitr, Ram Navami, Mahavir Jayanti, Good Friday, Buddha
    Purnima, Bakrid, Muharram, Independence Day, Id-e-Milad, Janmashtami,
    Gandhi Jayanti, Dussehra, Diwali, Guru Nanak Jayanti, Christmas)
  - **Festival / Office Holiday** — add these yourself for any date
  - **Leave** — mark any day you're taking off
  - On any non-working day, the Enter/Exit buttons disable themselves
- **Mark a day** several ways:
  - A dedicated red **MARK TODAY AS LEAVE** button sits right under the
    Enter/Exit buttons on the Home screen — separate and visually distinct
    so a quick tap can't be confused with starting your day
  - Tap **"More options"** on Home for Festival/Holiday/Working overrides
  - Or tap **any day** in Monthly Summary to set/change its status —
    past or future
- **Remarks** — add a free-text note to any day (e.g. "WFH", "client visit",
  "half day") from the same Mark-a-day sheet; shown inline in the logs list
- **Download Monthly Summary as PDF** — a button on the Monthly Summary
  screen opens a clean printable report (stats + full day-by-day table with
  remarks) and triggers your browser's Print dialog — choose "Save as PDF"
  there. No internet connection or external library needed for this.
- Today's card: Enter time, Exit time, hours worked, with a little
  "ink-stamp" animation when you punch
- Recent logs list + a full **Monthly Summary** with separate counts for
  **Working Days**, **Leave**, and **Holidays**, plus total hours and a
  full day-by-day breakdown with month navigation
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

## Updating an existing GitHub Pages site
If you've already deployed an earlier version (e.g. at
`https://yourname.github.io/your-repo/`), just upload these updated files
the same way — go to the repo on GitHub, click **Add file → Upload files**,
drag in `index.html` and `app.js` (the two that changed), and commit. Your
live site updates within about a minute, automatically — no need to touch
the Pages settings again.

## Want changes?
A few easy follow-ups if useful:
- A PIN/passcode lock on the app
- Holidays for a different year, or state-specific holidays — just edit the
  `NATIONAL_HOLIDAYS` list in `app.js` (each entry is `{year, month, day, name}`,
  month is 0-indexed)
- Reminder notification if you forget to punch Exit
- Export raw data as CSV (in addition to the PDF summary)
