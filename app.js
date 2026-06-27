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
  return all[key] || null;
}

function getOrBuildEntry(date) {
  const key = dateKey(date);
  const existing = getEntry(key);
  if (existing) return existing;
  return {
    dateString: key,
    dateMillis: startOfDay(date).getTime(),
    dayOfWeek: dayCode(date),
    isHoliday: isWeekendHoliday(date),
    enterTimeMillis: null,
    exitTimeMillis: null,
    enterTimeDisplay: null,
    exitTimeDisplay: null
  };
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
      result.push(existing);
    } else {
      result.push({
        dateString: key,
        dateMillis: startOfDay(d).getTime(),
        dayOfWeek: dayCode(d),
        isHoliday: isWeekendHoliday(d),
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
  holidayTag: document.getElementById('holidayTag'),
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
  statHours: document.getElementById('statHours'),
  statHolidays: document.getElementById('statHolidays'),
  monthList: document.getElementById('monthList'),
};

let summaryAnchor = new Date();

function tickHeaderClock() {
  els.headerClock.textContent = new Date().toLocaleTimeString('en-US', { hour12: false });
}
setInterval(tickHeaderClock, 1000);
tickHeaderClock();

function renderToday() {
  const now = new Date();
  els.todayDate.textContent = displayDateFull(now);

  const entry = getOrBuildEntry(now);
  const holiday = isWeekendHoliday(now);

  els.holidayTag.classList.toggle('show', holiday);

  els.valEnter.textContent = entry.enterTimeDisplay || '--:--';
  els.valExit.textContent = entry.exitTimeDisplay || '--:--';
  const mins = workedMinutes(entry);
  els.valTotal.textContent = mins != null ? formatDuration(mins) : '--';

  if (holiday) {
    els.btnEnter.disabled = true;
    els.btnExit.disabled = true;
  } else {
    els.btnEnter.disabled = !!entry.enterTimeMillis;
    els.btnExit.disabled = !entry.enterTimeMillis || !!entry.exitTimeMillis;
  }
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
    div.className = 'log-item' + (entry.isHoliday ? ' holiday' : '');
    const d = new Date(entry.dateMillis);

    let detail, right;
    if (entry.isHoliday) {
      detail = 'Holiday';
      right = '—';
    } else if (entry.enterTimeDisplay && entry.exitTimeDisplay) {
      detail = `${entry.enterTimeDisplay} → ${entry.exitTimeDisplay}`;
      const mins = workedMinutes(entry);
      right = mins != null ? formatDuration(mins) : '--';
    } else if (entry.enterTimeDisplay) {
      detail = `Entered ${entry.enterTimeDisplay}`;
      right = 'In progress';
    } else {
      detail = 'No punches';
      right = '--';
    }

    div.innerHTML = `
      <div class="left">
        <div class="d">${displayDate(d)} (${entry.dayOfWeek})</div>
        <div class="t">${detail}</div>
      </div>
      <div class="right">${right}</div>
    `;
    els.recentList.appendChild(div);
  }
}

function renderSummary() {
  const year = summaryAnchor.getFullYear();
  const monthIndex = summaryAnchor.getMonth();
  els.monthLabel.textContent = monthLabel(summaryAnchor);

  const entries = getMonthEntries(year, monthIndex);

  const workDays = entries.filter(e => !e.isHoliday && e.enterTimeMillis).length;
  const holidays = entries.filter(e => e.isHoliday).length;
  const totalMins = entries.reduce((sum, e) => {
    const m = workedMinutes(e);
    return sum + (m || 0);
  }, 0);

  els.statWorkDays.textContent = workDays;
  els.statHolidays.textContent = holidays;
  els.statHours.textContent = formatDuration(totalMins);

  els.monthList.innerHTML = '';
  for (const entry of entries) {
    const div = document.createElement('div');
    div.className = 'log-item' + (entry.isHoliday ? ' holiday' : '');
    const d = new Date(entry.dateMillis);

    let detail, right;
    if (entry.isHoliday) {
      detail = 'Holiday';
      right = '—';
    } else if (entry.enterTimeDisplay && entry.exitTimeDisplay) {
      detail = `${entry.enterTimeDisplay} → ${entry.exitTimeDisplay}`;
      const mins = workedMinutes(entry);
      right = mins != null ? formatDuration(mins) : '--';
    } else if (entry.enterTimeDisplay) {
      detail = `Entered ${entry.enterTimeDisplay}`;
      right = 'In progress';
    } else {
      detail = 'No punches';
      right = '--';
    }

    div.innerHTML = `
      <div class="left">
        <div class="d">${displayDate(d)} (${entry.dayOfWeek})</div>
        <div class="t">${detail}</div>
      </div>
      <div class="right">${right}</div>
    `;
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

  if (isWeekendHoliday(networkDate)) {
    els.statusMsg.textContent = 'Today is a holiday (Sat/Sun). No punch needed.';
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
