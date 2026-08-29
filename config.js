// ---------------------------------------------------------------------------
// APPLICATION CONFIG — edit the values below, then deploy.
// ---------------------------------------------------------------------------
const APP_CONFIG = {
  // From Google Cloud Console → APIs & Services → Credentials →
  // OAuth 2.0 Client ID (type: Web application).
  // Add your deployed URL (e.g. https://yourname.github.io) AND
  // http://localhost:5500 (or whatever you use locally) under
  // "Authorized JavaScript origins". No client secret is needed — this
  // app uses the browser-side token flow, which is the correct/safe
  // approach for a site with no backend (GitHub Pages, HF static Spaces).
  GOOGLE_CLIENT_ID: "445375462639-kah8ol3qf5ok3ianf3fm74gj8712j9cq.apps.googleusercontent.com",

  // Calendar scope — only touches events this app creates, not your whole calendar.
  CALENDAR_SCOPE: "https://www.googleapis.com/auth/calendar.events",

  // Default reminder offsets (days before deadline) applied to every
  // event this app creates. Editable per-entry in the UI too.
  DEFAULT_REMINDER_DAYS: [30, 7, 1],

  // Which Google Calendar to write to. "primary" is the user's main calendar.
  CALENDAR_ID: "primary",
};
