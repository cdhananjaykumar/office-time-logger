/* ===================== Storage layer (localStorage) ===================== */
const STORE_KEY = 'office_time_logger_entries_v1';

function loadAllEntries() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    console.error('Failed to read storage', e);
    return {};
  }
}

function saveAllEntries(entries) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(entries));
  } catch (e) {
    console.error('Failed to write storage', e);
  }
}

/* ===================== Date helpers ===================== */
function dateKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function dayCode(d) {
  return ['SUN','MON','TUE','WED','THU','FRI','SAT'][d.getDay()];
}

function isWeekendHoliday(d) {
  const day = d.getDay(); // 0 = Sunday, 6 = Saturday
  return day === 0 || day === 6;
}

function displayDate(d) {
  return d.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' });
}

function displayDateFull(d) {
  return d.toLocaleDateString('en-US', { weekday: 'long', day: '2-digit', month: 'short', year: 'numeric' });
}

function displayTime(d) {
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
}

function monthLabel(d) {
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function formatDuration(totalMinutes) {
  const h = Math.floor(totalMinutes / 60);
  const m = Math.round(totalMinutes % 60);
  return `${h}h ${m}m`;
}

function startOfDay(d) {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

function daysInMonth(year, monthIndex) {
  return new Date(year, monthIndex + 1, 0).getDate();
}

/* ===================== Day type model =====================
   Every day has exactly one "dayType":
   - WORKING:  a normal working day (default for any weekday)
   - WEEKEND:  Saturday/Sunday, auto-detected, can't be manually removed
   - NATIONAL: fixed-date national holiday (pre-filled list below), repeats every year
   - FESTIVAL: a holiday the user adds themselves (festival, office-declared, etc.)
   - LEAVE:    the user is on leave that day
   These replace the old simple isHoliday boolean. Old saved entries (which
   only had isHoliday: true/false) are migrated automatically on load. */

const DAY_TYPE = {
  WORKING: 'WORKING',
  WEEKEND: 'WEEKEND',
  NATIONAL: 'NATIONAL',
  FESTIVAL: 'FESTIVAL',
  LEAVE: 'LEAVE',
};

const DAY_TYPE_LABEL = {
  WORKING: 'Working Day',
  WEEKEND: 'Weekend',
  NATIONAL: 'National Holiday',
  FESTIVAL: 'Festival Holiday',
  LEAVE: 'Leave',
};

// Fixed-date Indian national holidays — same date every year, pre-filled.
// month is 0-indexed (0 = January) to match JS Date conventions.
const NATIONAL_HOLIDAYS = [
  { month: 0, day: 26, name: 'Republic Day' },
  { month: 7, day: 15, name: 'Independence Day' },
  { month: 9, day: 2, name: 'Gandhi Jayanti' },
];

function getNationalHolidayName(d) {
  const month = d.getMonth();
  const day = d.getDate();
  const match = NATIONAL_HOLIDAYS.find(h => h.month === month && h.day === day);
  return match ? match.name : null;
}

function isNonWorking(dayType) {
  return dayType !== DAY_TYPE.WORKING;
}

function isHolidayType(dayType) {
  return dayType === DAY_TYPE.WEEKEND || dayType === DAY_TYPE.NATIONAL || dayType === DAY_TYPE.FESTIVAL;
}

/** Determine the default day type for a date that has no saved override. */
function defaultDayType(d) {
  if (isWeekendHoliday(d)) return DAY_TYPE.WEEKEND;
  const nationalName = getNationalHolidayName(d);
  if (nationalName) return DAY_TYPE.NATIONAL;
  return DAY_TYPE.WORKING;
}

/* ===================== Network time provider =====================
   Browsers cannot do raw NTP (UDP), so we use a layered HTTPS strategy:
   1) Try a couple of small JSON "world time" style endpoints.
   2) Fall back to reading the Date response header from a reliable HTTPS
      request (a trick browsers themselves use to detect clock skew) —
      this works against almost any HTTPS server, so it's a robust fallback.
   If everything fails (e.g. fully offline), we report failure rather than
   silently trusting the device clock, so a punch is never logged on an
   unverified time. */

async function fetchNetworkTime() {
  // Try several independent, free, CORS-enabled time APIs in order.
  // Using more than one provider means a single API going down or rate-
  // limiting us doesn't take the whole app down with it.
  const providers = [
    fetchTimeApiIo,
    fetchTimeApiWorld,
    fetchFromHeader,
  ];

  for (const provider of providers) {
    try {
      const result = await provider();
      if (result && isPlausibleTime(result)) return { success: true, date: result };
    } catch (e) {
      // try next provider
    }
  }

  return {
    success: false,
    reason: 'Could not reach a time server. Check your internet connection and try again.'
  };
}

function isPlausibleTime(date) {
  // Reject obviously broken responses (epoch 0, NaN, or wildly off from
  // the device clock) rather than trusting a malformed API reply blindly.
  if (!date || isNaN(date.getTime())) return false;
  const fiveYearsMs = 1000 * 60 * 60 * 24 * 365 * 5;
  const deviceNow = Date.now();
  return Math.abs(date.getTime() - deviceNow) < fiveYearsMs && date.getFullYear() > 2000;
}

function withTimeout(promiseFactory, ms = 6000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);
  return promiseFactory(controller.signal).finally(() => clearTimeout(timeout));
}

async function fetchTimeApiIo() {
  return withTimeout(async (signal) => {
    const res = await fetch('https://timeapi.io/api/time/current/zone?timeZone=UTC', {
      signal, cache: 'no-store'
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || !data.dateTime) return null;
    // dateTime is like "2026-06-27T12:34:56.789" in UTC, no offset suffix
    return new Date(data.dateTime + 'Z');
  });
}

async function fetchTimeApiWorld() {
  return withTimeout(async (signal) => {
    const res = await fetch('https://timeapi.world/api/timezone/Etc/UTC', {
      signal, cache: 'no-store'
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data && data.unixtime) return new Date(data.unixtime * 1000);
    if (data && data.utc_datetime) return new Date(data.utc_datetime);
    return null;
  });
}

async function fetchFromHeader() {
  // Last-resort fallback: read the Date header from a same-origin-friendly
  // HTTPS response. Only works if the server sends CORS headers; kept as a
  // final attempt in case both dedicated time APIs are unreachable.
  return withTimeout(async (signal) => {
    const res = await fetch('https://timeapi.io/', { signal, cache: 'no-store', mode: 'cors' });
    const headerDate = res.headers.get('date');
    if (!headerDate) return null;
    return new Date(headerDate);
  });
}

/* ===================== Repository (business logic) ===================== */
function getEntry(key) {
  const all = loadAllEntries();
  const raw = all[key] || null;
  return raw ? migrateEntry(raw) : null;
}

/** Migrates old-format entries (boolean isHoliday) to the new dayType model.
 * Old data is never lost — we just add a dayType field, inferred as best we can. */
function migrateEntry(entry) {
  if (entry.dayType) return entry; // already new format
  const d = new Date(entry.dateMillis);
  entry.dayType = entry.isHoliday ? defaultDayType(d) : DAY_TYPE.WORKING;
  return entry;
}

function getOrBuildEntry(date) {
  const key = dateKey(date);
  const existing = getEntry(key);
  if (existing) return existing;

  const dayType = defaultDayType(date);
  return {
    dateString: key,
    dateMillis: startOfDay(date).getTime(),
    dayOfWeek: dayCode(date),
    dayType: dayType,
    isHoliday: isHolidayType(dayType), // kept for display convenience/back-compat
    enterTimeMillis: null,
    exitTimeMillis: null,
    enterTimeDisplay: null,
    exitTimeDisplay: null
  };
}

/** Sets/overrides the day type for a given date (e.g. mark as Leave, Festival,
 * or reset back to Working/auto-detected). Clears punch data if the new type
 * is non-working, since a holiday/leave day shouldn't carry stray punches. */
function setDayType(date, dayType) {
  const entry = getOrBuildEntry(date);
  entry.dayType = dayType;
  entry.isHoliday = isHolidayType(dayType);
  if (isNonWorking(dayType)) {
    entry.enterTimeMillis = null;
    entry.exitTimeMillis = null;
    entry.enterTimeDisplay = null;
    entry.exitTimeDisplay = null;
  }
  saveEntry(entry);
  return entry;
}

function saveEntry(entry) {
  const all = loadAllEntries();
  all[entry.dateString] = entry;
  saveAllEntries(all);
}

function workedMinutes(entry) {
  if (!entry.enterTimeMillis || !entry.exitTimeMillis) return null;
  const diff = entry.exitTimeMillis - entry.enterTimeMillis;
  return diff > 0 ? diff / 60000 : null;
}

const PUNCH_OK = 'ok';
const PUNCH_ERROR = 'error';

function punchEnter(networkDate) {
  const entry = getOrBuildEntry(networkDate);
  if (isNonWorking(entry.dayType)) {
    return { status: PUNCH_ERROR, message: `Today is marked as ${DAY_TYPE_LABEL[entry.dayType]}. No punch needed.` };
  }
  if (entry.enterTimeMillis) {
    return { status: PUNCH_ERROR, message: `You've already punched Enter today at ${entry.enterTimeDisplay}.` };
  }
  entry.enterTimeMillis = networkDate.getTime();
  entry.enterTimeDisplay = displayTime(networkDate);
  saveEntry(entry);
  return { status: PUNCH_OK, entry };
}

function punchExit(networkDate) {
  const entry = getOrBuildEntry(networkDate);
  if (isNonWorking(entry.dayType)) {
    return { status: PUNCH_ERROR, message: `Today is marked as ${DAY_TYPE_LABEL[entry.dayType]}. No punch needed.` };
  }
  if (!entry.enterTimeMillis) {
    return { status: PUNCH_ERROR, message: "You haven't punched Enter yet today." };
  }
  if (entry.exitTimeMillis) {
    return { status: PUNCH_ERROR, message: `You've already punched Exit today at ${entry.exitTimeDisplay}.` };
  }
  if (networkDate.getTime() <= entry.enterTimeMillis) {
    return { status: PUNCH_ERROR, message: 'Exit time cannot be before your Enter time.' };
  }
  entry.exitTimeMillis = networkDate.getTime();
  entry.exitTimeDisplay = displayTime(networkDate);
  saveEntry(entry);
  return { status: PUNCH_OK, entry };
}

function getRecentEntries(limit = 20) {
  const all = loadAllEntries();
  return Object.values(all)
    .map(migrateEntry)
    .sort((a, b) => b.dateMillis - a.dateMillis)
    .slice(0, limit);
}

function getMonthEntries(year, monthIndex) {
  const all = loadAllEntries();
  const total = daysInMonth(year, monthIndex);
  const result = [];
  for (let day = 1; day <= total; day++) {
    const d = new Date(year, monthIndex, day);
    const key = dateKey(d);
    const existing = all[key];
    if (existing) {
      result.push(migrateEntry(existing));
    } else {
      const dayType = defaultDayType(d);
      result.push({
        dateString: key,
        dateMillis: startOfDay(d).getTime(),
        dayOfWeek: dayCode(d),
        dayType: dayType,
        isHoliday: isHolidayType(dayType),
        enterTimeMillis: null,
        exitTimeMillis: null,
        enterTimeDisplay: null,
        exitTimeDisplay: null
      });
    }
  }
  return result.sort((a, b) => b.dateMillis - a.dateMillis);
}

/* ===================== UI rendering ===================== */
const els = {
  headerClock: document.getElementById('headerClock'),
  todayDate: document.getElementById('todayDate'),
  statusTag: document.getElementById('statusTag'),
  markTodayBtn: document.getElementById('markTodayBtn'),
  valEnter: document.getElementById('valEnter'),
  valExit: document.getElementById('valExit'),
  valTotal: document.getElementById('valTotal'),
  cellEnter: document.getElementById('cellEnter'),
  cellExit: document.getElementById('cellExit'),
  cellTotal: document.getElementById('cellTotal'),
  btnEnter: document.getElementById('btnEnter'),
  btnExit: document.getElementById('btnExit'),
  statusMsg: document.getElementById('statusMsg'),
  recentList: document.getElementById('recentList'),
  goSummaryLink: document.getElementById('goSummaryLink'),
  tabHome: document.getElementById('tabHome'),
  tabSummary: document.getElementById('tabSummary'),
  viewHome: document.getElementById('view-home'),
  viewSummary: document.getElementById('view-summary'),
  prevMonth: document.getElementById('prevMonth'),
  nextMonth: document.getElementById('nextMonth'),
  monthLabel: document.getElementById('monthLabel'),
  statWorkDays: document.getElementById('statWorkDays'),
  statLeave: document.getElementById('statLeave'),
  statHours: document.getElementById('statHours'),
  statHolidays: document.getElementById('statHolidays'),
  monthList: document.getElementById('monthList'),
  sheetBackdrop: document.getElementById('sheetBackdrop'),
  sheet: document.getElementById('sheet'),
  sheetTitle: document.getElementById('sheetTitle'),
  sheetOptions: document.getElementById('sheetOptions'),
  sheetCancel: document.getElementById('sheetCancel'),
};

let summaryAnchor = new Date();

function tickHeaderClock() {
  els.headerClock.textContent = new Date().toLocaleTimeString('en-US', { hour12: false });
}
setInterval(tickHeaderClock, 1000);
tickHeaderClock();

// Maps a dayType to the CSS class used for status tags / log item accents.
const DAY_TYPE_CSS_CLASS = {
  WEEKEND: 'weekend',
  NATIONAL: 'national',
  FESTIVAL: 'festival',
  LEAVE: 'leave',
};

function renderToday() {
  const now = new Date();
  els.todayDate.textContent = displayDateFull(now);

  const entry = getOrBuildEntry(now);
  const nonWorking = isNonWorking(entry.dayType);

  if (nonWorking) {
    const cls = DAY_TYPE_CSS_CLASS[entry.dayType] || '';
    els.statusTag.className = 'status-tag show ' + cls;
    els.statusTag.textContent = '● ' + DAY_TYPE_LABEL[entry.dayType].toUpperCase();
  } else {
    els.statusTag.className = 'status-tag';
    els.statusTag.textContent = '';
  }

  els.valEnter.textContent = entry.enterTimeDisplay || '--:--';
  els.valExit.textContent = entry.exitTimeDisplay || '--:--';
  const mins = workedMinutes(entry);
  els.valTotal.textContent = mins != null ? formatDuration(mins) : '--';

  if (nonWorking) {
    els.btnEnter.disabled = true;
    els.btnExit.disabled = true;
  } else {
    els.btnEnter.disabled = !!entry.enterTimeMillis;
    els.btnExit.disabled = !entry.enterTimeMillis || !!entry.exitTimeMillis;
  }

  // The "Mark today as..." link is hidden once a punch has been made today,
  // since changing the day type would wipe that punch — keeping it visible
  // until then avoids an accidental data-losing tap.
  els.markTodayBtn.style.display = entry.enterTimeMillis ? 'none' : '';
  els.markTodayBtn.textContent = nonWorking
    ? `Marked as ${DAY_TYPE_LABEL[entry.dayType]} — tap to change`
    : 'Mark today as Leave / Holiday →';
}

function describeEntry(entry) {
  if (isNonWorking(entry.dayType)) {
    return { detail: DAY_TYPE_LABEL[entry.dayType], right: '—', cssClass: DAY_TYPE_CSS_CLASS[entry.dayType] || 'holiday' };
  }
  if (entry.enterTimeDisplay && entry.exitTimeDisplay) {
    const mins = workedMinutes(entry);
    return {
      detail: `${entry.enterTimeDisplay} → ${entry.exitTimeDisplay}`,
      right: mins != null ? formatDuration(mins) : '--',
      cssClass: ''
    };
  }
  if (entry.enterTimeDisplay) {
    return { detail: `Entered ${entry.enterTimeDisplay}`, right: 'In progress', cssClass: '' };
  }
  return { detail: 'No punches', right: '--', cssClass: '' };
}

function renderRecentList() {
  const entries = getRecentEntries(20);
  els.recentList.innerHTML = '';

  if (entries.length === 0) {
    els.recentList.innerHTML = '<div class="empty-state">No logs yet. Tap ENTER when you reach office.</div>';
    return;
  }

  for (const entry of entries) {
    const div = document.createElement('div');
    const { detail, right, cssClass } = describeEntry(entry);
    div.className = 'log-item' + (cssClass ? ' ' + cssClass : '');
    const d = new Date(entry.dateMillis);

    div.innerHTML = `
      <div class="left">
        <div class="d">${displayDate(d)} (${entry.dayOfWeek})</div>
        <div class="t">${detail}</div>
      </div>
      <div class="right">${right}</div>
    `;
    div.addEventListener('click', () => openDayStatusSheet(d));
    els.recentList.appendChild(div);
  }
}

function renderSummary() {
  const year = summaryAnchor.getFullYear();
  const monthIndex = summaryAnchor.getMonth();
  els.monthLabel.textContent = monthLabel(summaryAnchor);

  const entries = getMonthEntries(year, monthIndex);

  const workDays = entries.filter(e => !isNonWorking(e.dayType) && e.enterTimeMillis).length;
  const leaveDays = entries.filter(e => e.dayType === DAY_TYPE.LEAVE).length;
  const holidays = entries.filter(e => isHolidayType(e.dayType)).length;
  const totalMins = entries.reduce((sum, e) => {
    const m = workedMinutes(e);
    return sum + (m || 0);
  }, 0);

  els.statWorkDays.textContent = workDays;
  els.statLeave.textContent = leaveDays;
  els.statHolidays.textContent = holidays;
  els.statHours.textContent = formatDuration(totalMins);

  els.monthList.innerHTML = '';
  for (const entry of entries) {
    const div = document.createElement('div');
    const { detail, right, cssClass } = describeEntry(entry);
    div.className = 'log-item' + (cssClass ? ' ' + cssClass : '');
    const d = new Date(entry.dateMillis);

    div.innerHTML = `
      <div class="left">
        <div class="d">${displayDate(d)} (${entry.dayOfWeek})</div>
        <div class="t">${detail}</div>
      </div>
      <div class="right">${right}</div>
    `;
    div.addEventListener('click', () => openDayStatusSheet(d));
    els.monthList.appendChild(div);
  }
}

/* ===================== Punch handling ===================== */
async function handlePunch(isEnter) {
  els.btnEnter.disabled = true;
  els.btnExit.disabled = true;
  els.statusMsg.classList.remove('error');
  els.statusMsg.textContent = 'Fetching network time…';

  const result = await fetchNetworkTime();

  if (!result.success) {
    els.statusMsg.classList.add('error');
    els.statusMsg.textContent = result.reason;
    renderToday();
    return;
  }

  const networkDate = result.date;

  // Re-check against the freshly-fetched network date (not just the device
  // clock) in case the day type depends on which calendar day it actually is.
  const freshEntry = getOrBuildEntry(networkDate);
  if (isNonWorking(freshEntry.dayType)) {
    els.statusMsg.textContent = `Today is marked as ${DAY_TYPE_LABEL[freshEntry.dayType]}. No punch needed.`;
    renderToday();
    return;
  }

  const punchResult = isEnter ? punchEnter(networkDate) : punchExit(networkDate);

  if (punchResult.status === PUNCH_OK) {
    els.statusMsg.textContent = '';
    const cell = isEnter ? els.cellEnter : els.cellExit;
    cell.classList.remove('just-stamped');
    requestAnimationFrame(() => cell.classList.add('just-stamped'));
    renderToday();
    renderRecentList();
  } else {
    els.statusMsg.classList.add('error');
    els.statusMsg.textContent = punchResult.message;
    renderToday();
  }
}

/* ===================== Day status picker (bottom sheet) =====================
   Shared by "Mark today" on Home and tap-any-day in Monthly Summary.
   Weekends and national holidays are shown as info (can't be removed,
   since they're calendar facts) but Working/Leave/Festival are switchable. */
let sheetTargetDate = null;

function openDayStatusSheet(date) {
  sheetTargetDate = date;
  const entry = getOrBuildEntry(date);
  const isAutoLocked = entry.dayType === DAY_TYPE.WEEKEND || entry.dayType === DAY_TYPE.NATIONAL;

  els.sheetTitle.textContent = displayDateFull(date);

  // Warn if punches exist and would be cleared by switching to non-working.
  const hasPunches = !!entry.enterTimeMillis;

  els.sheetOptions.innerHTML = '';

  if (isAutoLocked) {
    // Weekend / National holiday dates are calendar facts — show as locked info,
    // but still allow switching to Leave/Festival isn't meaningful here, so just inform.
    const info = document.createElement('div');
    info.className = 'sheet-option selected';
    info.style.cursor = 'default';
    const label = entry.dayType === DAY_TYPE.WEEKEND
      ? 'Weekend (automatic)'
      : `National Holiday — ${getNationalHolidayName(date) || ''}`;
    info.innerHTML = `<span class="dot ${DAY_TYPE_CSS_CLASS[entry.dayType] || 'weekend'}"></span> ${label}`;
    els.sheetOptions.appendChild(info);
  } else {
    const options = [
      { type: DAY_TYPE.WORKING, label: 'Working Day', dot: 'working' },
      { type: DAY_TYPE.LEAVE, label: 'Leave', dot: 'leave' },
      { type: DAY_TYPE.FESTIVAL, label: 'Festival / Office Holiday', dot: 'festival' },
    ];
    for (const opt of options) {
      const btn = document.createElement('button');
      btn.className = 'sheet-option' + (entry.dayType === opt.type ? ' selected' : '');
      btn.innerHTML = `<span class="dot ${opt.dot}"></span> ${opt.label}`;
      btn.addEventListener('click', () => applyDayStatus(opt.type, hasPunches));
      els.sheetOptions.appendChild(btn);
    }
  }

  els.sheetBackdrop.classList.add('show');
}

function applyDayStatus(dayType, hadPunches) {
  if (hadPunches && isNonWorking(dayType)) {
    const ok = confirm('This will clear the Enter/Exit times already logged for this day. Continue?');
    if (!ok) return;
  }
  setDayType(sheetTargetDate, dayType);
  closeDayStatusSheet();
  renderToday();
  renderRecentList();
  if (els.viewSummary.classList.contains('active')) renderSummary();
}

function closeDayStatusSheet() {
  els.sheetBackdrop.classList.remove('show');
  sheetTargetDate = null;
}

els.sheetBackdrop.addEventListener('click', (e) => {
  if (e.target === els.sheetBackdrop) closeDayStatusSheet();
});
els.sheetCancel.addEventListener('click', closeDayStatusSheet);
els.markTodayBtn.addEventListener('click', () => openDayStatusSheet(new Date()));

/* ===================== Navigation ===================== */
function showView(name) {
  els.viewHome.classList.toggle('active', name === 'home');
  els.viewSummary.classList.toggle('active', name === 'summary');
  els.tabHome.classList.toggle('active', name === 'home');
  els.tabSummary.classList.toggle('active', name === 'summary');
  if (name === 'summary') renderSummary();
}

els.tabHome.addEventListener('click', () => showView('home'));
els.tabSummary.addEventListener('click', () => showView('summary'));
els.goSummaryLink.addEventListener('click', () => showView('summary'));

els.btnEnter.addEventListener('click', () => handlePunch(true));
els.btnExit.addEventListener('click', () => handlePunch(false));

els.prevMonth.addEventListener('click', () => {
  summaryAnchor = new Date(summaryAnchor.getFullYear(), summaryAnchor.getMonth() - 1, 1);
  renderSummary();
});
els.nextMonth.addEventListener('click', () => {
  summaryAnchor = new Date(summaryAnchor.getFullYear(), summaryAnchor.getMonth() + 1, 1);
  renderSummary();
});

/* ===================== Init ===================== */
renderToday();
renderRecentList();

// Refresh the today-card at next local midnight so the date rolls over
// even if the user leaves the app open overnight.
function scheduleMidnightRefresh() {
  const now = new Date();
  const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5);
  const ms = nextMidnight.getTime() - now.getTime();
  setTimeout(() => {
    renderToday();
    renderRecentList();
    scheduleMidnightRefresh();
  }, ms);
}
scheduleMidnightRefresh();

// Register service worker for offline support / installability
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
