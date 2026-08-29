"use strict";

/* =========================================================================
   STATE
========================================================================= */
const STORAGE_KEY = "ledger_shortlist_v1";
const REMINDER_KEY = "ledger_reminder_days_v1";

function loadShortlist(){
  try{ return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }
  catch(e){ return []; }
}
function saveShortlist(list){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}
function loadReminderDays(){
  try{
    const raw = JSON.parse(localStorage.getItem(REMINDER_KEY));
    if (Array.isArray(raw) && raw.length) return raw;
  }catch(e){}
  return APP_CONFIG.DEFAULT_REMINDER_DAYS.slice();
}
function saveReminderDays(days){
  localStorage.setItem(REMINDER_KEY, JSON.stringify(days));
}

let shortlist = loadShortlist();
let reminderDays = loadReminderDays();

function uid(){ return "e_" + Date.now().toString(36) + Math.random().toString(36).slice(2,7); }

/* =========================================================================
   TOAST
========================================================================= */
let toastTimer = null;
function toast(msg, kind){
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.className = "toast" + (kind ? " is-" + kind : "");
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>{ el.hidden = true; }, 3800);
}

/* =========================================================================
   TAB NAVIGATION
========================================================================= */
const tabs = document.querySelectorAll(".tab");
const pages = document.querySelectorAll(".page");
function showTab(name){
  tabs.forEach(t => t.setAttribute("aria-current", t.dataset.tab === name ? "true" : "false"));
  pages.forEach(p => { p.hidden = p.id !== "page-" + name; });
  if (name === "shortlist") renderShortlist();
}
tabs.forEach(t => t.addEventListener("click", () => showTab(t.dataset.tab)));

/* =========================================================================
   GOOGLE CALENDAR AUTH  (browser-side token flow — no backend, no secret)
========================================================================= */
let tokenClient = null;
let accessToken = null;
let tokenExpiry = 0;
let pendingAfterAuth = null;

function gisReady(){ return typeof google !== "undefined" && google.accounts && google.accounts.oauth2; }

function initGoogleAuth(){
  if (!gisReady()){ setTimeout(initGoogleAuth, 300); return; }
  if (APP_CONFIG.GOOGLE_CLIENT_ID.startsWith("YOUR_CLIENT_ID")){
    setAuthUI(false, "Set your Client ID in config.js");
    return;
  }
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: APP_CONFIG.GOOGLE_CLIENT_ID,
    scope: APP_CONFIG.CALENDAR_SCOPE,
    callback: (resp) => {
      if (resp.error){
        toast("Google sign-in failed: " + resp.error, "error");
        return;
      }
      accessToken = resp.access_token;
      tokenExpiry = Date.now() + (resp.expires_in * 1000);
      setAuthUI(true);
      toast("Google Calendar connected", "success");
      if (pendingAfterAuth){ const fn = pendingAfterAuth; pendingAfterAuth = null; fn(); }
    },
  });
  setAuthUI(false);
}

function setAuthUI(connected, note){
  const dotWrap = document.getElementById("authStatus");
  const text = document.getElementById("authStatusText");
  const line = document.getElementById("settingsAuthLine");
  dotWrap.classList.toggle("auth-status--on", connected);
  dotWrap.classList.toggle("auth-status--off", !connected);
  text.textContent = note || (connected ? "Calendar connected" : "Calendar not connected");
  if (line) line.textContent = connected
    ? "Connected. New shortlist entries can sync straight to your primary calendar."
    : (note || "Not connected. Click below to grant calendar access.");
  [document.getElementById("authButton"), document.getElementById("authButton2")].forEach(btn=>{
    if (!btn) return;
    btn.textContent = connected ? "Reconnect" : "Connect Calendar";
  });
}

function ensureAuth(callback){
  if (!tokenClient){
    toast("Google auth isn't ready yet — set GOOGLE_CLIENT_ID in config.js", "error");
    return;
  }
  if (accessToken && Date.now() < tokenExpiry - 60000){ callback(); return; }
  pendingAfterAuth = callback;
  tokenClient.requestAccessToken({ prompt: accessToken ? "" : "consent" });
}

function disconnectGoogle(){
  if (accessToken){
    google.accounts.oauth2.revoke(accessToken, () => {});
  }
  accessToken = null;
  tokenExpiry = 0;
  setAuthUI(false);
  toast("Disconnected from Google Calendar");
}

/* ---- Calendar event CRUD -------------------------------------------- */
async function createCalendarEvent(entry){
  const overrides = reminderDays.map(d => ({ method: "popup", minutes: d * 24 * 60 }));
  const body = {
    summary: `${entry.university} — ${entry.degree} deadline`,
    description: [entry.notes, entry.link].filter(Boolean).join("\n"),
    start: { date: entry.deadline },
    end: { date: entry.deadline },
    reminders: { useDefault: false, overrides },
  };
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(APP_CONFIG.CALENDAR_ID)}/events`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || `Calendar API error (${res.status})`);
  return data.id;
}

async function deleteCalendarEvent(eventId){
  if (!eventId) return;
  await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(APP_CONFIG.CALENDAR_ID)}/events/${eventId}`,
    { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` } }
  ).catch(()=>{});
}

function syncEntry(entryId){
  const entry = shortlist.find(e => e.id === entryId);
  if (!entry) return;
  ensureAuth(async () => {
    try{
      const eventId = await createCalendarEvent(entry);
      entry.calendarEventId = eventId;
      entry.synced = true;
      saveShortlist(shortlist);
      renderShortlist();
      toast(`Reminder set for ${entry.university}`, "success");
    }catch(err){
      toast("Couldn't sync: " + err.message, "error");
    }
  });
}

function syncAll(){
  const pending = shortlist.filter(e => !e.synced);
  if (!pending.length){ toast("Everything is already synced"); return; }
  ensureAuth(async () => {
    let ok = 0, fail = 0;
    for (const entry of pending){
      try{
        entry.calendarEventId = await createCalendarEvent(entry);
        entry.synced = true;
        ok++;
      }catch(e){ fail++; }
    }
    saveShortlist(shortlist);
    renderShortlist();
    toast(`Synced ${ok} ${fail ? `(${fail} failed)` : ""}`.trim(), fail ? "error" : "success");
  });
}

/* =========================================================================
   UNIVERSITY SEARCH  (Hipolabs open directory — name/country only)
========================================================================= */
async function searchUniversities(name){
  const q = encodeURIComponent(name.trim());
  const urls = [
    `https://universities.hipolabs.com/search?name=${q}`,
    `http://universities.hipolabs.com/search?name=${q}`, // fallback if https isn't served
  ];
  for (const url of urls){
    try{
      const res = await fetch(url);
      if (!res.ok) continue;
      const data = await res.json();
      return data.slice(0, 12);
    }catch(e){ /* try next */ }
  }
  throw new Error("University directory is unreachable right now");
}

const COMMON_DEGREES = [
  "BSc Computer Science","BA Economics","BEng Mechanical Engineering","BBA",
  "MS Computer Science","MSc Data Science","MEng Electrical Engineering",
  "MBA","MA International Relations","MPH Public Health","MPhil",
  "LLM","JD","MFA","PhD Computer Science","PhD Biology",
  "MSc Artificial Intelligence","MSc Finance","MArch Architecture",
];
(function fillDegreeSuggestions(){
  const dl = document.getElementById("degreeSuggestions");
  dl.innerHTML = COMMON_DEGREES.map(d => `<option value="${escapeHtml(d)}"></option>`).join("");
})();

document.getElementById("searchForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const uniQuery = document.getElementById("uniQuery").value.trim();
  const degreeQuery = document.getElementById("degreeQuery").value.trim();
  const resultsEl = document.getElementById("searchResults");

  if (!uniQuery){ toast("Type a university name to search"); return; }

  resultsEl.innerHTML = `<p class="hint">Searching…</p>`;
  try{
    const results = await searchUniversities(uniQuery);
    if (!results.length){
      resultsEl.innerHTML = `<p class="hint">No matches. You can still file it manually below.</p>`;
      openEntryModal({ university: uniQuery, degree: degreeQuery });
      return;
    }
    resultsEl.innerHTML = "";
    results.forEach(u => {
      const row = document.createElement("div");
      row.className = "result-row";
      row.innerHTML = `
        <div class="result-main">
          <div class="result-name">${escapeHtml(u.name)}</div>
          <div class="result-meta">${escapeHtml(u.country || "")}${u.web_pages?.[0] ? " · " + escapeHtml(u.web_pages[0]) : ""}</div>
        </div>
        <button class="btn btn-ink btn-small">File it</button>
      `;
      row.querySelector("button").addEventListener("click", () => {
        openEntryModal({ university: u.name, country: u.country, degree: degreeQuery, link: u.web_pages?.[0] || "" });
      });
      resultsEl.appendChild(row);
    });
  }catch(err){
    resultsEl.innerHTML = `<p class="hint">${escapeHtml(err.message)}. You can still file this university manually.</p>`;
    openEntryModal({ university: uniQuery, degree: degreeQuery });
  }
});

/* =========================================================================
   ENTRY MODAL  (search result → shortlist, or manual add)
========================================================================= */
const modal = document.getElementById("entryModal");
function openEntryModal(prefill){
  prefill = prefill || {};
  document.getElementById("m_university").value = prefill.university || "";
  document.getElementById("m_country").value = prefill.country || "";
  document.getElementById("m_degree").value = prefill.degree || "";
  document.getElementById("m_deadline").value = prefill.deadline || "";
  document.getElementById("m_notes").value = prefill.notes || "";
  document.getElementById("m_syncNow").checked = true;
  modal.dataset.link = prefill.link || "";
  modal.hidden = false;
  document.getElementById("m_university").focus();
}
function closeEntryModal(){ modal.hidden = true; }
document.getElementById("modalCancel").addEventListener("click", closeEntryModal);
modal.addEventListener("click", (e) => { if (e.target === modal) closeEntryModal(); });

document.getElementById("entryForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const entry = {
    id: uid(),
    university: document.getElementById("m_university").value.trim(),
    country: document.getElementById("m_country").value.trim(),
    degree: document.getElementById("m_degree").value.trim(),
    deadline: document.getElementById("m_deadline").value,
    notes: document.getElementById("m_notes").value.trim(),
    link: modal.dataset.link || "",
    synced: false,
    calendarEventId: null,
    createdAt: Date.now(),
  };
  const syncNow = document.getElementById("m_syncNow").checked;
  shortlist.push(entry);
  saveShortlist(shortlist);
  closeEntryModal();
  toast(`Filed ${entry.university}`, "success");
  if (syncNow) syncEntry(entry.id);
  showTab("shortlist");
});

/* =========================================================================
   SHORTLIST RENDERING
========================================================================= */
let activeFilter = "all";
document.querySelectorAll(".chip").forEach(chip => {
  chip.addEventListener("click", () => {
    document.querySelectorAll(".chip").forEach(c => c.classList.remove("is-active"));
    chip.classList.add("is-active");
    activeFilter = chip.dataset.filter;
    renderShortlist();
  });
});

function daysUntil(dateStr){
  const target = new Date(dateStr + "T00:00:00");
  const now = new Date();
  now.setHours(0,0,0,0);
  return Math.round((target - now) / 86400000);
}

function stampClassFor(days, synced){
  if (days < 0) return "is-done";
  if (days <= 7) return "is-urgent";
  if (days <= 30) return "is-upcoming";
  return "";
}

function renderShortlist(){
  const grid = document.getElementById("shortlistList");
  const empty = document.getElementById("shortlistEmpty");

  let list = shortlist.slice().sort((a,b) => (a.deadline || "").localeCompare(b.deadline || ""));
  list = list.filter(e => {
    const d = e.deadline ? daysUntil(e.deadline) : null;
    if (activeFilter === "upcoming") return d !== null && d >= 0;
    if (activeFilter === "urgent") return d !== null && d >= 0 && d <= 7;
    if (activeFilter === "synced") return !!e.synced;
    if (activeFilter === "done") return d !== null && d < 0;
    return true;
  });

  if (!list.length){
    grid.innerHTML = "";
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  grid.innerHTML = list.map(e => {
    const d = e.deadline ? daysUntil(e.deadline) : null;
    const stampCls = d === null ? "" : stampClassFor(d, e.synced);
    const stampNum = d === null ? "—" : (d < 0 ? "0" : d);
    const stampLabel = d === null ? "no date" : (d < 0 ? "past due" : "days left");
    return `
      <article class="entry-card">
        <div class="stamp ${stampCls}">
          <span class="stamp-num">${stampNum}</span>
          <span class="stamp-label">${stampLabel}</span>
        </div>
        <div class="card-university">${escapeHtml(e.university)}</div>
        <div class="card-degree">${escapeHtml(e.degree || "Degree not set")}</div>
        ${e.country ? `<div class="card-country">${escapeHtml(e.country)}${e.deadline ? " · " + e.deadline : ""}</div>` : (e.deadline ? `<div class="card-country">${e.deadline}</div>` : "")}
        ${e.notes ? `<div class="card-notes">${escapeHtml(e.notes)}</div>` : ""}
        <div class="card-actions">
          ${e.synced
            ? `<button class="btn btn-ghost btn-small" data-act="unsync" data-id="${e.id}">Remove reminder</button>`
            : `<button class="btn btn-forest btn-small" data-act="sync" data-id="${e.id}">Sync to Calendar</button>`}
          <button class="btn btn-ghost btn-small" data-act="delete" data-id="${e.id}">Delete</button>
        </div>
        ${e.synced ? `<div class="card-synced-line">✓ Reminder set in Google Calendar</div>` : ""}
      </article>
    `;
  }).join("");

  grid.querySelectorAll("[data-act='sync']").forEach(b => b.addEventListener("click", () => syncEntry(b.dataset.id)));
  grid.querySelectorAll("[data-act='unsync']").forEach(b => b.addEventListener("click", async () => {
    const entry = shortlist.find(x => x.id === b.dataset.id);
    if (!entry) return;
    ensureAuth(async () => {
      await deleteCalendarEvent(entry.calendarEventId);
      entry.synced = false;
      entry.calendarEventId = null;
      saveShortlist(shortlist);
      renderShortlist();
      toast("Reminder removed");
    });
  }));
  grid.querySelectorAll("[data-act='delete']").forEach(b => b.addEventListener("click", async () => {
    const entry = shortlist.find(x => x.id === b.dataset.id);
    if (!entry) return;
    if (!confirm(`Remove ${entry.university} from your shortlist?`)) return;
    if (entry.synced && entry.calendarEventId){
      ensureAuth(async () => {
        await deleteCalendarEvent(entry.calendarEventId);
        shortlist = shortlist.filter(x => x.id !== entry.id);
        saveShortlist(shortlist);
        renderShortlist();
      });
    }else{
      shortlist = shortlist.filter(x => x.id !== entry.id);
      saveShortlist(shortlist);
      renderShortlist();
    }
  }));
}

document.getElementById("syncAllBtn").addEventListener("click", syncAll);

/* =========================================================================
   EXCEL / CSV UPLOAD
========================================================================= */
const dropZone = document.getElementById("dropZone");
const fileInput = document.getElementById("fileInput");
let pendingRows = [];

dropZone.addEventListener("click", () => fileInput.click());
dropZone.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") fileInput.click(); });
dropZone.addEventListener("dragover", (e) => { e.preventDefault(); dropZone.classList.add("is-drag"); });
dropZone.addEventListener("dragleave", () => dropZone.classList.remove("is-drag"));
dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropZone.classList.remove("is-drag");
  if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
});
fileInput.addEventListener("change", () => { if (fileInput.files[0]) handleFile(fileInput.files[0]); });

const COLUMN_ALIASES = {
  university: ["university", "school", "institution", "college", "name"],
  degree: ["degree", "program", "programme", "course", "major"],
  deadline: ["deadline", "duedate", "due date", "applicationdeadline", "date"],
  country: ["country", "location", "nation"],
  notes: ["notes", "note", "comments", "remarks"],
  link: ["link", "url", "website", "programlink"],
};

function normalizeHeader(h){ return String(h || "").trim().toLowerCase().replace(/[\s_-]+/g, ""); }

function mapColumns(headers){
  const map = {};
  const normalized = headers.map(normalizeHeader);
  Object.entries(COLUMN_ALIASES).forEach(([field, aliases]) => {
    const aliasSet = aliases.map(a => a.replace(/[\s_-]+/g, ""));
    const idx = normalized.findIndex(h => aliasSet.includes(h));
    if (idx > -1) map[field] = headers[idx];
  });
  return map;
}

function excelSerialToISO(value){
  // Handles both real Date objects and Excel's numeric date serials.
  if (value instanceof Date && !isNaN(value)) return value.toISOString().slice(0,10);
  if (typeof value === "number"){
    const d = new Date(Math.round((value - 25569) * 86400 * 1000));
    if (!isNaN(d)) return d.toISOString().slice(0,10);
  }
  if (typeof value === "string"){
    const d = new Date(value);
    if (!isNaN(d)) return d.toISOString().slice(0,10);
  }
  return "";
}

function handleFile(file){
  const reader = new FileReader();
  reader.onload = (e) => {
    try{
      const wb = XLSX.read(e.target.result, { type: "array", cellDates: true });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
      if (!rows.length){ toast("That sheet looks empty", "error"); return; }
      const headers = Object.keys(rows[0]);
      const colMap = mapColumns(headers);

      if (!colMap.university || !colMap.degree || !colMap.deadline){
        toast("Couldn't find University / Degree / Deadline columns — check your headers", "error");
        return;
      }

      pendingRows = rows.map(r => ({
        university: String(r[colMap.university] || "").trim(),
        degree: String(r[colMap.degree] || "").trim(),
        deadline: excelSerialToISO(r[colMap.deadline]),
        country: colMap.country ? String(r[colMap.country] || "").trim() : "",
        notes: colMap.notes ? String(r[colMap.notes] || "").trim() : "",
        link: colMap.link ? String(r[colMap.link] || "").trim() : "",
      })).filter(r => r.university);

      renderPreview();
    }catch(err){
      toast("Couldn't read that file: " + err.message, "error");
    }
  };
  reader.readAsArrayBuffer(file);
}

function renderPreview(){
  document.getElementById("uploadPreviewWrap").hidden = false;
  document.getElementById("previewCount").textContent = pendingRows.length;
  const table = document.getElementById("previewTable");
  table.innerHTML = `
    <thead><tr><th>University</th><th>Degree</th><th>Deadline</th><th>Country</th><th>Notes</th></tr></thead>
    <tbody>
      ${pendingRows.map(r => `
        <tr>
          <td>${escapeHtml(r.university)}</td>
          <td>${escapeHtml(r.degree) || `<span class="cell-bad">missing</span>`}</td>
          <td class="${r.deadline ? "" : "cell-bad"}">${r.deadline || "unrecognized date"}</td>
          <td>${escapeHtml(r.country)}</td>
          <td>${escapeHtml(r.notes)}</td>
        </tr>
      `).join("")}
    </tbody>
  `;
}

document.getElementById("cancelImportBtn").addEventListener("click", () => {
  pendingRows = [];
  document.getElementById("uploadPreviewWrap").hidden = true;
  fileInput.value = "";
});

document.getElementById("confirmImportBtn").addEventListener("click", () => {
  const valid = pendingRows.filter(r => r.deadline);
  const skipped = pendingRows.length - valid.length;
  valid.forEach(r => {
    shortlist.push({
      id: uid(),
      university: r.university,
      degree: r.degree,
      deadline: r.deadline,
      country: r.country,
      notes: r.notes,
      link: r.link,
      synced: false,
      calendarEventId: null,
      createdAt: Date.now(),
    });
  });
  saveShortlist(shortlist);
  pendingRows = [];
  document.getElementById("uploadPreviewWrap").hidden = true;
  fileInput.value = "";
  toast(`Added ${valid.length} to shortlist${skipped ? ` (${skipped} skipped — no valid date)` : ""}`, "success");
  showTab("shortlist");
});

/* =========================================================================
   SETTINGS
========================================================================= */
document.getElementById("authButton").addEventListener("click", () => ensureAuth(() => {}));
document.getElementById("authButton2").addEventListener("click", () => ensureAuth(() => {}));
document.getElementById("disconnectBtn").addEventListener("click", disconnectGoogle);

document.getElementById("reminderDaysInput").value = reminderDays.join(", ");
document.getElementById("saveReminderDaysBtn").addEventListener("click", () => {
  const raw = document.getElementById("reminderDaysInput").value;
  const days = raw.split(",").map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n) && n >= 0);
  if (!days.length){ toast("Enter at least one valid number of days", "error"); return; }
  reminderDays = days;
  saveReminderDays(days);
  toast("Reminder timing saved. Applies to newly synced entries.", "success");
});

document.getElementById("exportBtn").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(shortlist, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "shortlist-export.json"; a.click();
  URL.revokeObjectURL(url);
});

document.getElementById("clearAllBtn").addEventListener("click", () => {
  if (!confirm("This deletes your entire local shortlist (calendar events already created will remain). Continue?")) return;
  shortlist = [];
  saveShortlist(shortlist);
  renderShortlist();
  toast("Cleared");
});

/* =========================================================================
   UTIL
========================================================================= */
function escapeHtml(str){
  return String(str || "").replace(/[&<>"']/g, m => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
  }[m]));
}

/* =========================================================================
   INIT
========================================================================= */
initGoogleAuth();
showTab("search");
renderShortlist();
