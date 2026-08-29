# Ledger — University Application Tracker

A static (no-backend) web app: shortlist universities, search real institutions,
bulk-import a spreadsheet of ones you've already scouted, and push application
deadlines straight into Google Calendar as reminders. Runs entirely in the
browser — deployable on GitHub Pages, Hugging Face static Spaces, or any
static host.

## Files
```
index.html    structure
style.css     styling
app.js        all logic (state, Google auth, calendar sync, search, import)
config.js     ← you edit this (Client ID + defaults)
sample-template.xlsx   a starter spreadsheet you can copy from
```

## 1. Get a Google OAuth Client ID (5 min, one-time)

This app uses Google's **browser-side token flow** — there's no server and no
client secret involved, which is the correct approach for a static site (a
secret can never be kept safe in browser JS anyway).

1. Go to [Google Cloud Console](https://console.cloud.google.com/) → create a
   project (or pick an existing one).
2. **APIs & Services → Library** → enable **Google Calendar API**.
3. **APIs & Services → OAuth consent screen** → set it up (External is fine
   for personal use; add yourself as a test user if it stays in "Testing"
   mode — that's fine, you don't need to publish it).
4. **APIs & Services → Credentials → Create Credentials → OAuth client ID**
   → Application type: **Web application**.
5. Under **Authorized JavaScript origins**, add every origin you'll load the
   app from, e.g.:
   - `https://<your-username>.github.io`
   - `http://localhost:5500` (or whatever local dev server/port you use)
   - your Hugging Face Space URL if you use one
   - Leave **Authorized redirect URIs** empty — the token flow doesn't use one.
6. Copy the generated **Client ID** (ends in `.apps.googleusercontent.com`).

Paste it into `config.js`:
```js
GOOGLE_CLIENT_ID: "123456789-abc.apps.googleusercontent.com",
```

That's the only required edit. `CALENDAR_SCOPE` is deliberately narrow
(`calendar.events`) — the app can create/delete events it made, not read or
touch anything else on your calendar.

## 2. Run it locally first

Because the app fetches from Google's and Hipolabs' APIs, open it through a
local server rather than a bare `file://` path:

```bash
cd app
python3 -m http.server 5500
# then open http://localhost:5500
```
(Make sure `http://localhost:5500` is also in your Authorized JavaScript
origins from step 1.)

## 3. Deploy

**GitHub Pages**
1. Push the `app/` folder's contents to a repo (or a `docs/` folder / `gh-pages`
   branch).
2. Repo → Settings → Pages → set the source branch/folder.
3. Your site will be at `https://<username>.github.io/<repo>/`. Add that exact
   origin (`https://<username>.github.io` — just the origin, not the full
   path) to your OAuth client's Authorized JavaScript origins.

**Hugging Face Spaces (static)**
1. Create a new Space → SDK: **Static**.
2. Upload `index.html`, `style.css`, `app.js`, `config.js`.
3. Add the Space's URL origin to Authorized JavaScript origins the same way.

## How each part works

- **Search** — university name/country lookup uses the free, keyless
  [Hipolabs university directory](https://github.com/Hipo/university-domains-list).
  It only knows institution names, countries, and domains — not specific
  degree programmes or deadlines (no free public database of those exists),
  so you type the degree yourself and set the deadline when filing a result
  to your shortlist.
- **Shortlist** — stored in the browser's `localStorage`, nothing leaves your
  machine except when you explicitly sync an entry to Calendar.
- **Upload** — `sample-template.xlsx` shows the expected shape. Column
  headers are matched case-insensitively and tolerate common variants
  (`School`/`Institution` → University, `Due Date` → Deadline, etc.). Rows
  missing a university, degree, or a parseable date are skipped and called
  out in the preview.
- **Calendar sync** — creates an all-day event on the deadline date with
  popup reminders at 30/7/1 days before by default (editable in Settings).
  Deleting or "un-syncing" an entry removes the matching calendar event.

## Limitations, honestly

- No backend means no shared/multi-device database — your shortlist lives in
  that one browser's local storage. Use **Settings → Export** to back it up
  as JSON, or re-upload via Excel on another device.
- There's no free API for granular degree-program data, so "search by
  degree" filters what's already in *your* shortlist/uploads rather than
  querying a live global course catalog.
- Google's OAuth token from the browser flow lasts about an hour; the app
  silently re-requests one when you sync again, which may show a quick
  Google popup if you've been idle.
