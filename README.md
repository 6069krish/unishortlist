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

## AI scouting (free-first)

Google's own free search APIs are being wound down for new users in 2026, and
there's no free public database of degree-specific admission requirements —
so instead of routing every lookup through a paid search API, scouting works
in two free-first tiers, plus an optional paid one for when you don't have a
direct link:

**1. Scout (free) — no key needed.** You give it the program's own admissions
page URL (auto-filled when it came from search results). The app fetches
that page through a free public CORS proxy (api.allorigins.win, with
api.codetabs.com as a fallback if the first is down/rate-limited), strips it
to plain text in your browser, and regex-scans it for deadline-shaped dates
and common requirement keywords (IELTS, GPA, SOP, letters of recommendation,
etc.). Zero cost, zero setup, works immediately.

**2. Free AI cleanup — optional, still $0.** If you add a free
[Google AI Studio](https://aistudio.google.com/apikey) Gemini API key in
Settings, "Scout (free)" hands the *already-fetched* page text to Gemini's
free tier (Flash-Lite, ~1,000 requests/day, no billing account needed) to
turn the raw keyword hits into a clean summary. This deliberately avoids
Google's paid "search grounding" fee — Gemini isn't searching the web here,
it's just reading text your browser already pulled down.

**3. Deep scout — optional, paid.** For a program where you don't have a
direct URL, "Deep scout" (Settings → your own Anthropic API key) runs a live
web search via Claude to find one. This is the only tier that costs real
money, and it's usually a fraction of a cent per lookup — use it as a
fallback, not the default.

**Caveats, honestly:**
- Free public CORS proxies are exactly that — free and public. They're
  sometimes slow, occasionally down, and rate-limited. The app tries two and
  tells you plainly if both fail; retry, or paste a different/more direct URL.
- Some university sites block proxied/bot-like requests entirely — if a page
  won't fetch, that's usually why.
- The regex keyword scan is dumb by design (it's just pattern-matching, not
  reading comprehension) — always sanity-check what it finds. The Gemini
  cleanup tier is considerably more reliable if you can spare 30 seconds to
  grab a free key.
- Every result — free or paid — is a starting point. Confirm dates and
  requirements on the university's own page before you rely on them.

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
