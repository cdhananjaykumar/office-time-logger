/* ===================== Storage helpers ===================== */
const STORAGE_KEY = 'office_time_logger_entries_v1';

function loadAllEntries() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); }
  catch { return {}; }
}
function saveAllEntries(entries) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

/* ===================== Date / time utilities ===================== */
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
  const day = d.getDay();
  return day === 0 || day === 6;
}
function displayDate(d) {
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}
function displayDateFull(d) {
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
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
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function daysInMonth(year, monthIndex) {
  return new Date(year, monthIndex + 1, 0).getDate();
}

/* ===================== Locking helpers ===================== */
/**
 * Returns true if a given date is a past calendar day (i.e. its date key
 * is earlier than today's). Used to determine if a day is fully locked.
 */
function isPastDate(d) {
  return dateKey(d) < dateKey(new Date());
}

/**
 * A day is "fully locked" (no edits of any kind) when:
 *  - The calendar date has changed (it's now a past day), OR
 *  - It's a Leave day and the current time is past 13:00 today
 * Weekends and National Holidays are always view-only (not user-editable)
 * but those are handled separately via the `isAutoLocked` flag in the sheet.
 */
function isDayLocked(entry) {
  const entryDate = new Date(entry.dateMillis);

  // Past date: fully locked regardless of type
  if (isPastDate(entryDate)) return true;

  // Leave marked after 13:00 today locks automatically
  if (entry.dayType === 'LEAVE') {
    const now = new Date();
    if (now.getHours() >= 13) return true;
  }

  // Exit punched on today's working day — still editable (can re-enter)
  return false;
}

/* ===================== Day-type definitions ===================== */
const DAY_TYPE = { WORKING: 'WORKING', WEEKEND: 'WEEKEND', NATIONAL: 'NATIONAL', FESTIVAL: 'FESTIVAL', LEAVE: 'LEAVE' };

const DAY_TYPE_LABEL = {
  WORKING: 'Working Day', WEEKEND: 'Weekend', NATIONAL: 'National Holiday',
  FESTIVAL: 'Festival Holiday', LEAVE: 'Leave',
};

// National/festival holidays as exact dated (year, month 1-indexed, day) entries.
// Lunar-calendar holidays shift yearly, so per-year entries are the only correct model.
const NATIONAL_HOLIDAYS = [
  { year: 2026, month: 1, day: 26, name: 'Republic Day' },
  { year: 2026, month: 3, day: 4,  name: 'Holi' },
  { year: 2026, month: 3, day: 21, name: 'Id-ul-Fitr' },
  { year: 2026, month: 3, day: 26, name: 'Ram Navami' },
  { year: 2026, month: 3, day: 31, name: 'Mahavir Jayanti' },
  { year: 2026, month: 4, day: 3,  name: 'Good Friday' },
  { year: 2026, month: 5, day: 1,  name: 'Buddha Purnima' },
  { year: 2026, month: 5, day: 27, name: 'Bakrid / Id-ul-Zuha' },
  { year: 2026, month: 6, day: 26, name: 'Muharram' },
  { year: 2026, month: 8, day: 15, name: 'Independence Day' },
  { year: 2026, month: 8, day: 26, name: 'Id-e-Milad' },
  { year: 2026, month: 9, day: 4,  name: 'Janmashtami' },
  { year: 2026, month: 10, day: 2, name: 'Gandhi Jayanti' },
  { year: 2026, month: 10, day: 20, name: 'Dussehra' },
  { year: 2026, month: 11, day: 8, name: 'Diwali' },
  { year: 2026, month: 11, day: 24, name: 'Guru Nanak Jayanti' },
  { year: 2026, month: 12, day: 25, name: 'Christmas' },
];

function getNationalHolidayName(d) {
  const year = d.getFullYear(), month = d.getMonth() + 1, day = d.getDate();
  const match = NATIONAL_HOLIDAYS.find(h => h.year === year && h.month === month && h.day === day);
  return match ? match.name : null;
}

function isNonWorking(dayType) { return dayType !== DAY_TYPE.WORKING; }
function isHolidayType(dayType) {
  return dayType === DAY_TYPE.WEEKEND || dayType === DAY_TYPE.NATIONAL || dayType === DAY_TYPE.FESTIVAL;
}

function defaultDayType(d) {
  // National holidays take priority over weekends (holiday falling on Sat/Sun
  // still shows its proper name).
  const nationalName = getNationalHolidayName(d);
  if (nationalName) return DAY_TYPE.NATIONAL;
  if (isWeekendHoliday(d)) return DAY_TYPE.WEEKEND;
  return DAY_TYPE.WORKING;
}

/* ===================== Network time ===================== */
async function fetchNetworkTime() {
  try { return { success: true, date: await withTimeout(fetchTimeApiIo) }; } catch {}
  try { return { success: true, date: await withTimeout(fetchTimeApiWorld) }; } catch {}
  try { return { success: true, date: await withTimeout(fetchFromHeader) }; } catch {}
  return { success: false, reason: 'Could not reach a time server. Please check your internet connection.' };
}
function isPlausibleTime(date) {
  const y = date.getFullYear();
  return y >= 2024 && y <= 2035;
}
function withTimeout(fn, ms = 6000) {
  return Promise.race([
    fn(),
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
}
async function fetchTimeApiIo() {
  const r = await fetch('https://timeapi.io/api/time/current/zone?timeZone=Asia/Kolkata');
  const j = await r.json();
  const d = new Date(j.dateTime);
  if (!isPlausibleTime(d)) throw new Error('bad time');
  return d;
}
async function fetchTimeApiWorld() {
  const r = await fetch('https://timeapi.world/api/time/current/zone?timeZone=Asia/Kolkata');
  const j = await r.json();
  const d = new Date(j.dateTime);
  if (!isPlausibleTime(d)) throw new Error('bad time');
  return d;
}
async function fetchFromHeader() {
  const r = await fetch(location.href, { method: 'HEAD', cache: 'no-store' });
  const dateHeader = r.headers.get('date');
  if (!dateHeader) throw new Error('no date header');
  const d = new Date(dateHeader);
  if (!isPlausibleTime(d)) throw new Error('bad time');
  return d;
}

/* ===================== Entry storage / model ===================== */
/**
 * An entry's punch sessions are stored as an array of
 * { enterMillis, enterDisplay, exitMillis?, exitDisplay? } objects.
 * This replaces the old single enterTimeMillis/exitTimeMillis pair.
 */
function getEntry(key) {
  const raw = loadAllEntries()[key] || null;
  return raw ? autoCloseIfNeeded(migrateEntry(raw)) : null;
}

function migrateEntry(entry) {
  // v1/v2: boolean isHoliday → dayType
  if (!entry.dayType) {
    const d = new Date(entry.dateMillis);
    entry.dayType = entry.isHoliday ? defaultDayType(d) : DAY_TYPE.WORKING;
  }
  if (entry.remark === undefined) entry.remark = '';

  // v3 → v4: single enter/exit pair → sessions array
  if (!entry.sessions) {
    entry.sessions = [];
    if (entry.enterTimeMillis) {
      entry.sessions.push({
        enterMillis: entry.enterTimeMillis,
        enterDisplay: entry.enterTimeDisplay || displayTime(new Date(entry.enterTimeMillis)),
        exitMillis: entry.exitTimeMillis || null,
        exitDisplay: entry.exitTimeDisplay || null,
      });
    }
    // Keep old fields as dead data (don't delete — avoids confusion if old sw.js caches serve a page that still references them)
  }
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
    dayType,
    isHoliday: isHolidayType(dayType),
    sessions: [],
    remark: '',
  };
}

function saveEntry(entry) {
  const all = loadAllEntries();
  all[entry.dateString] = entry;
  saveAllEntries(all);
}

/**
 * Total worked minutes for a day = sum of all completed sessions.
 * An open session (entered but not exited yet) contributes 0 until closed.
 */
function totalWorkedMinutes(entry) {
  let total = 0;
  for (const s of (entry.sessions || [])) {
    if (s.enterMillis && s.exitMillis && s.exitMillis > s.enterMillis) {
      total += (s.exitMillis - s.enterMillis) / 60000;
    }
  }
  return total > 0 ? total : null;
}

/** The auto-logout time: 21:00 (9:00 PM). Any open session still running at
 *  this time — on the same day or a past day — is automatically closed here.
 *  This is called every time an entry is read for display or logic, so it
 *  self-heals even if the app was closed when 9 PM passed. */
function autoCloseIfNeeded(entry) {
  const sessions = entry.sessions || [];
  let modified = false;

  for (const s of sessions) {
    if (s.enterMillis && !s.exitMillis) {
      const entryDate = new Date(entry.dateMillis);
      // Auto-close time: 9:00 PM on the day of the entry
      const autoCloseTime = new Date(
        entryDate.getFullYear(),
        entryDate.getMonth(),
        entryDate.getDate(),
        21, 0, 0, 0
      );

      const now = new Date();
      // Close if: it's past 9 PM on the entry day, OR the date has changed
      if (now >= autoCloseTime || isPastDate(entryDate)) {
        s.exitMillis = autoCloseTime.getTime();
        s.exitDisplay = '9:00 PM (auto)';
        modified = true;
      }
    }
  }

  if (modified) saveEntry(entry);
  return entry;
}

/** True if there is an open session (entered but not exited). */
function hasOpenSession(entry) {
  return (entry.sessions || []).some(s => s.enterMillis && !s.exitMillis);
}

/** True if any session exists at all (entered at least once). */
function hasAnyPunch(entry) {
  return (entry.sessions || []).length > 0;
}

/** The most recent open session, or null. */
function openSession(entry) {
  return (entry.sessions || []).slice().reverse().find(s => s.enterMillis && !s.exitMillis) || null;
}

function setDayType(date, dayType) {
  const entry = getOrBuildEntry(date);
  if (isDayLocked(entry)) return entry; // locked, ignore
  entry.dayType = dayType;
  entry.isHoliday = isHolidayType(dayType);
  if (isNonWorking(dayType)) {
    entry.sessions = [];
  }
  saveEntry(entry);
  return entry;
}

function setRemark(date, remarkText) {
  const entry = getOrBuildEntry(date);
  if (isDayLocked(entry)) return entry; // locked, ignore
  entry.remark = (remarkText || '').trim().slice(0, 200);
  saveEntry(entry);
  return entry;
}

const PUNCH_OK = 'ok';
const PUNCH_ERROR = 'error';

function punchEnter(networkDate) {
  const entry = getOrBuildEntry(networkDate);
  if (isNonWorking(entry.dayType)) {
    return { status: PUNCH_ERROR, message: `Today is marked as ${DAY_TYPE_LABEL[entry.dayType]}. No punch needed.` };
  }
  if (isDayLocked(entry)) {
    return { status: PUNCH_ERROR, message: 'This day is locked and cannot be edited.' };
  }
  if (hasOpenSession(entry)) {
    const s = openSession(entry);
    return { status: PUNCH_ERROR, message: `Already entered at ${s.enterDisplay}. Exit first.` };
  }
  entry.sessions.push({
    enterMillis: networkDate.getTime(),
    enterDisplay: displayTime(networkDate),
    exitMillis: null,
    exitDisplay: null,
  });
  saveEntry(entry);
  return { status: PUNCH_OK, entry };
}

function punchExit(networkDate) {
  const entry = getOrBuildEntry(networkDate);
  if (isNonWorking(entry.dayType)) {
    return { status: PUNCH_ERROR, message: `Today is marked as ${DAY_TYPE_LABEL[entry.dayType]}. No punch needed.` };
  }
  if (isDayLocked(entry)) {
    return { status: PUNCH_ERROR, message: 'This day is locked and cannot be edited.' };
  }
  const open = openSession(entry);
  if (!open) {
    return { status: PUNCH_ERROR, message: "You haven't punched Enter yet today." };
  }
  if (networkDate.getTime() <= open.enterMillis) {
    return { status: PUNCH_ERROR, message: 'Exit time cannot be before your Enter time.' };
  }
  open.exitMillis = networkDate.getTime();
  open.exitDisplay = displayTime(networkDate);
  saveEntry(entry);
  return { status: PUNCH_OK, entry };
}

function getRecentEntries(limit = 20) {
  const all = loadAllEntries();
  return Object.values(all).map(e => autoCloseIfNeeded(migrateEntry(e)))
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
      result.push(autoCloseIfNeeded(migrateEntry(existing)));
    } else {
      const dayType = defaultDayType(d);
      result.push({
        dateString: key,
        dateMillis: startOfDay(d).getTime(),
        dayOfWeek: dayCode(d),
        dayType,
        isHoliday: isHolidayType(dayType),
        sessions: [],
        remark: '',
      });
    }
  }
  // Day 1 → 31 ascending (rule #5)
  return result.sort((a, b) => a.dateMillis - b.dateMillis);
}

/* ===================== UI element bindings ===================== */
const els = {
  headerClock: document.getElementById('headerClock'),
  todayDate: document.getElementById('todayDate'),
  statusTag: document.getElementById('statusTag'),
  markTodayBtn: document.getElementById('markTodayBtn'),
  leaveTodayBtn: document.getElementById('leaveTodayBtn'),
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
  downloadPdfBtn: document.getElementById('downloadPdfBtn'),
  sheetBackdrop: document.getElementById('sheetBackdrop'),
  sheet: document.getElementById('sheet'),
  sheetTitle: document.getElementById('sheetTitle'),
  sheetOptions: document.getElementById('sheetOptions'),
  sheetRemark: document.getElementById('sheetRemark'),
  sheetSaveRemark: document.getElementById('sheetSaveRemark'),
  sheetCancel: document.getElementById('sheetCancel'),
};

let summaryAnchor = new Date();

function tickHeaderClock() {
  els.headerClock.textContent = new Date().toLocaleTimeString('en-US', { hour12: false });
}
setInterval(tickHeaderClock, 1000);
tickHeaderClock();

const DAY_TYPE_CSS_CLASS = {
  WEEKEND: 'weekend', NATIONAL: 'national', FESTIVAL: 'festival', LEAVE: 'leave',
};

/* ===================== Rendering ===================== */
function renderToday() {
  const now = new Date();
  els.todayDate.textContent = displayDateFull(now);

  const entry = getOrBuildEntry(now);
  const nonWorking = isNonWorking(entry.dayType);
  const locked = isDayLocked(entry);

  if (nonWorking) {
    const cls = DAY_TYPE_CSS_CLASS[entry.dayType] || '';
    els.statusTag.className = 'status-tag show ' + cls;
    els.statusTag.textContent = '● ' + DAY_TYPE_LABEL[entry.dayType].toUpperCase();
  } else {
    els.statusTag.className = 'status-tag';
    els.statusTag.textContent = '';
  }

  // Show most recent session's enter/exit for the card display
  const sessions = entry.sessions || [];
  const lastSession = sessions[sessions.length - 1] || null;
  const open = openSession(entry);
  const totalMins = totalWorkedMinutes(entry);

  els.valEnter.textContent = lastSession ? lastSession.enterDisplay : '--:--';
  els.valExit.textContent = (lastSession && lastSession.exitDisplay) ? lastSession.exitDisplay : '--:--';
  els.valTotal.textContent = totalMins != null ? formatDuration(totalMins) : '--';

  // Session count badge (only when > 1 session recorded today)
  const sessionCount = sessions.length;
  const sessionLabel = sessionCount > 1 ? ` (${sessionCount} sessions)` : '';
  if (sessionCount > 1) {
    els.valTotal.textContent = (totalMins != null ? formatDuration(totalMins) : '--') + sessionLabel;
  }

  // Button states
  if (nonWorking || locked) {
    els.btnEnter.disabled = true;
    els.btnExit.disabled = true;
  } else {
    els.btnEnter.disabled = !!open; // disabled if a session is open
    els.btnExit.disabled = !open;   // disabled if no open session
  }

  // Leave + More-options controls
  // Leave can be set until 13:00 today (if before 13:00 and no punches yet).
  // Once any punch exists today, Leave is not applicable.
  const isAfter1pm = now.getHours() >= 13;
  const hasPunches = hasAnyPunch(entry);

  if (locked || hasPunches) {
    // Day locked (past date or Leave after 1pm) or working day started — hide controls
    els.leaveTodayBtn.style.display = 'none';
    els.markTodayBtn.style.display = 'none';
  } else if (nonWorking) {
    // Already marked non-working but not locked yet
    els.leaveTodayBtn.style.display = 'none';
    els.markTodayBtn.style.display = '';
    els.markTodayBtn.textContent = `Marked as ${DAY_TYPE_LABEL[entry.dayType]} — tap to change`;
  } else {
    // Working day, no punches, before lock — show Leave button if before 1pm
    els.leaveTodayBtn.style.display = isAfter1pm ? 'none' : '';
    els.markTodayBtn.style.display = '';
    els.markTodayBtn.textContent = 'More options (Festival / Holiday / Working) →';
  }
}

function describeEntry(entry) {
  const remarkSuffix = entry.remark ? ` · 📝 ${entry.remark}` : '';
  if (isNonWorking(entry.dayType)) {
    return {
      detail: DAY_TYPE_LABEL[entry.dayType] + remarkSuffix,
      right: '—',
      cssClass: DAY_TYPE_CSS_CLASS[entry.dayType] || 'holiday',
      totalMins: null,
    };
  }
  const sessions = entry.sessions || [];
  const totalMins = totalWorkedMinutes(entry);
  const open = openSession(entry);

  if (sessions.length === 0) {
    return { detail: 'No punches' + remarkSuffix, right: '--', cssClass: '', totalMins: null };
  }

  // Build detail line: summarise all sessions
  let detail;
  if (sessions.length === 1) {
    const s = sessions[0];
    detail = s.exitDisplay
      ? `${s.enterDisplay} → ${s.exitDisplay}`
      : `Entered ${s.enterDisplay}`;
  } else {
    const first = sessions[0].enterDisplay;
    const last = sessions[sessions.length - 1];
    const end = last.exitDisplay || '…';
    detail = `${first} → ${end} (${sessions.length} sessions)`;
  }

  const rightLabel = open
    ? 'In progress'
    : totalMins != null ? formatDuration(totalMins) : '--';

  return { detail: detail + remarkSuffix, right: rightLabel, cssClass: '', totalMins };
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
    const locked = isDayLocked(entry);
    div.innerHTML = `
      <div class="left">
        <div class="d">${displayDate(d)} (${entry.dayOfWeek})${locked ? ' 🔒' : ''}</div>
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

  // getMonthEntries returns day 1→31 ascending (rule #5)
  const entries = getMonthEntries(year, monthIndex);

  const workDays = entries.filter(e => !isNonWorking(e.dayType) && hasAnyPunch(e)).length;
  const leaveDays = entries.filter(e => e.dayType === DAY_TYPE.LEAVE).length;
  const holidays = entries.filter(e => isHolidayType(e.dayType)).length;
  const totalMins = entries.reduce((sum, e) => sum + (totalWorkedMinutes(e) || 0), 0);

  els.statWorkDays.textContent = workDays;
  els.statLeave.textContent = leaveDays;
  els.statHolidays.textContent = holidays;
  els.statHours.textContent = formatDuration(totalMins);

  els.monthList.innerHTML = '';
  for (const entry of entries) {
    const div = document.createElement('div');
    const { detail, right, cssClass, totalMins: dayMins } = describeEntry(entry);
    const d = new Date(entry.dateMillis);
    const locked = isDayLocked(entry);

    // Rule #6: hours color — green if ≥ 8h (480 mins), red if < 8h (working days only)
    let hoursColorClass = '';
    if (!isNonWorking(entry.dayType) && dayMins != null) {
      hoursColorClass = dayMins >= 480 ? 'hours-green' : 'hours-red';
    }

    div.className = 'log-item' + (cssClass ? ' ' + cssClass : '');
    div.innerHTML = `
      <div class="left">
        <div class="d">${displayDate(d)} (${entry.dayOfWeek})${locked ? ' 🔒' : ''}</div>
        <div class="t">${detail}</div>
      </div>
      <div class="right ${hoursColorClass}">${right}</div>
    `;
    div.addEventListener('click', () => openDayStatusSheet(d));
    els.monthList.appendChild(div);
  }
}

/* ===================== PDF export ===================== */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function downloadMonthlySummaryPdf() {
  const year = summaryAnchor.getFullYear();
  const monthIndex = summaryAnchor.getMonth();
  // PDF always day 1→31 ascending
  const entries = getMonthEntries(year, monthIndex);

  const workDays = entries.filter(e => !isNonWorking(e.dayType) && hasAnyPunch(e)).length;
  const leaveDays = entries.filter(e => e.dayType === DAY_TYPE.LEAVE).length;
  const holidays = entries.filter(e => isHolidayType(e.dayType)).length;
  const totalMins = entries.reduce((sum, e) => sum + (totalWorkedMinutes(e) || 0), 0);

  const rows = entries.map(entry => {
    const d = new Date(entry.dateMillis);
    const { detail, right, totalMins: dayMins } = describeEntry(entry);
    const remark = entry.remark ? escapeHtml(entry.remark) : '';
    // Rule #3: holiday/weekend rows in red in PDF
    const isRedRow = isHolidayType(entry.dayType);
    const rowStyle = isRedRow ? ' style="color:#C0392B;"' : '';
    // Rule #6: hours column color in PDF
    let hoursStyle = '';
    if (!isNonWorking(entry.dayType) && dayMins != null) {
      hoursStyle = dayMins >= 480 ? ' style="color:#1E8E3E;font-weight:bold;"' : ' style="color:#C0392B;font-weight:bold;"';
    }
    return `<tr${rowStyle}>
      <td>${displayDate(d)}</td>
      <td>${entry.dayOfWeek}</td>
      <td>${escapeHtml(DAY_TYPE_LABEL[entry.dayType])}</td>
      <td>${escapeHtml(detail)}</td>
      <td${hoursStyle}>${escapeHtml(right)}</td>
      <td>${remark}</td>
    </tr>`;
  }).join('');

  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<title>Office Time Logger — ${escapeHtml(monthLabel(summaryAnchor))}</title>
<style>
  body{font-family:Arial,Helvetica,sans-serif;color:#1A1A1A;margin:32px;}
  h1{font-size:18px;margin-bottom:2px;}
  h2{font-size:13px;font-weight:normal;color:#5A5747;margin-top:0;margin-bottom:20px;}
  table{width:100%;border-collapse:collapse;font-size:11px;}
  th,td{border:1px solid #D8D2BC;padding:6px 8px;text-align:left;}
  th{background:#EDE7D6;}
  .stats{display:flex;gap:24px;margin-bottom:20px;flex-wrap:wrap;}
  .stat{border:1px solid #D8D2BC;border-radius:6px;padding:10px 16px;}
  .stat .v{font-size:18px;font-weight:bold;}
  .stat .l{font-size:10px;color:#5A5747;text-transform:uppercase;}
  @media print{ @page{margin:16mm;} }
</style></head>
<body>
  <h1>Office Time Logger</h1>
  <h2>Monthly Summary — ${escapeHtml(monthLabel(summaryAnchor))}</h2>
  <div class="stats">
    <div class="stat"><div class="v">${workDays}</div><div class="l">Working Days</div></div>
    <div class="stat"><div class="v">${leaveDays}</div><div class="l">Leave</div></div>
    <div class="stat"><div class="v">${holidays}</div><div class="l">Holidays</div></div>
    <div class="stat"><div class="v">${formatDuration(totalMins)}</div><div class="l">Total Hours</div></div>
  </div>
  <table>
    <thead><tr><th>Date</th><th>Day</th><th>Type</th><th>Sessions</th><th>Hours</th><th>Remark</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <script>window.onload = () => window.print();<\/script>
</body></html>`;

  const win = window.open('', '_blank');
  if (!win) { alert('Please allow pop-ups for this site to download the PDF.'); return; }
  win.document.open();
  win.document.write(html);
  win.document.close();
}

els.downloadPdfBtn.addEventListener('click', downloadMonthlySummaryPdf);

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

/* ===================== Day status sheet ===================== */
let sheetTargetDate = null;

function openDayStatusSheet(date) {
  sheetTargetDate = date;
  const entry = getOrBuildEntry(date);
  const locked = isDayLocked(entry);
  const isAutoLocked = entry.dayType === DAY_TYPE.WEEKEND || entry.dayType === DAY_TYPE.NATIONAL;

  els.sheetTitle.textContent = displayDateFull(date) + (locked ? ' 🔒' : '');
  els.sheetRemark.value = entry.remark || '';
  els.sheetRemark.disabled = locked;
  els.sheetSaveRemark.disabled = locked;

  const hasPunches = hasAnyPunch(entry);
  els.sheetOptions.innerHTML = '';

  if (locked || isAutoLocked) {
    // View-only — show current status as non-interactive info
    const info = document.createElement('div');
    info.className = 'sheet-option selected';
    info.style.cursor = 'default';
    let label;
    if (entry.dayType === DAY_TYPE.WEEKEND) label = 'Weekend (automatic)';
    else if (entry.dayType === DAY_TYPE.NATIONAL) label = `National Holiday — ${getNationalHolidayName(date) || ''}`;
    else label = DAY_TYPE_LABEL[entry.dayType];
    if (locked) label += ' (locked)';
    info.innerHTML = `<span class="dot ${DAY_TYPE_CSS_CLASS[entry.dayType] || 'working'}"></span> ${label}`;
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

  // Show session list if there are multiple sessions
  const sessions = entry.sessions || [];
  let sessionHtml = '';
  if (sessions.length > 0) {
    sessionHtml = `<div class="sheet-sessions">
      <div class="sheet-remark-label">Sessions today</div>
      ${sessions.map((s, i) => `
        <div class="session-row">
          <span>Session ${i + 1}: ${s.enterDisplay}</span>
          <span>${s.exitDisplay ? '→ ' + s.exitDisplay : '(open)'}</span>
          ${(s.exitMillis && s.enterMillis) ? `<span class="session-dur">${formatDuration((s.exitMillis - s.enterMillis) / 60000)}</span>` : ''}
        </div>`).join('')}
    </div>`;
  }
  // Insert session list before remark block
  els.sheetOptions.insertAdjacentHTML('afterend', sessionHtml);

  els.sheetBackdrop.classList.add('show');
}

function applyDayStatus(dayType, hadPunches) {
  if (hadPunches && isNonWorking(dayType)) {
    const ok = confirm('This will clear the Enter/Exit times already logged for this day. Continue?');
    if (!ok) return;
  }
  setDayType(sheetTargetDate, dayType);
  setRemark(sheetTargetDate, els.sheetRemark.value);
  closeDayStatusSheet();
  renderToday();
  renderRecentList();
  if (els.viewSummary.classList.contains('active')) renderSummary();
}

function closeDayStatusSheet() {
  // Clean up any session list we injected before
  const existing = document.querySelector('.sheet-sessions');
  if (existing) existing.remove();
  els.sheetBackdrop.classList.remove('show');
  sheetTargetDate = null;
}

els.sheetSaveRemark.addEventListener('click', () => {
  if (!sheetTargetDate) return;
  setRemark(sheetTargetDate, els.sheetRemark.value);
  renderToday();
  renderRecentList();
  if (els.viewSummary.classList.contains('active')) renderSummary();
  closeDayStatusSheet();
});

els.sheetBackdrop.addEventListener('click', (e) => {
  if (e.target === els.sheetBackdrop) closeDayStatusSheet();
});
els.sheetCancel.addEventListener('click', closeDayStatusSheet);
els.markTodayBtn.addEventListener('click', () => openDayStatusSheet(new Date()));

els.leaveTodayBtn.addEventListener('click', () => {
  const today = new Date();
  if (today.getHours() >= 13) {
    alert('Leave can only be marked before 1:00 PM.');
    return;
  }
  const entry = getOrBuildEntry(today);
  if (hasAnyPunch(entry)) {
    const ok = confirm('This will clear the punch times already logged for today. Continue?');
    if (!ok) return;
  }
  setDayType(today, DAY_TYPE.LEAVE);
  renderToday();
  renderRecentList();
  if (els.viewSummary.classList.contains('active')) renderSummary();
});

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

// Refresh at next local midnight so the date card rolls over if left open overnight
function scheduleMidnightRefresh() {
  const now = new Date();
  const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5);
  const ms = nextMidnight.getTime() - now.getTime();
  setTimeout(() => { renderToday(); renderRecentList(); scheduleMidnightRefresh(); }, ms);
}
scheduleMidnightRefresh();

// At 9:00 PM, auto-close any open session and refresh the UI
function schedule9pmAutoClose() {
  const now = new Date();
  const ninepm = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 21, 0, 5);
  // If 9 PM already passed today, schedule for tomorrow's 9 PM
  if (now >= ninepm) ninepm.setDate(ninepm.getDate() + 1);
  const ms = ninepm.getTime() - now.getTime();
  setTimeout(() => {
    renderToday();
    renderRecentList();
    if (els.viewSummary.classList.contains('active')) renderSummary();
    schedule9pmAutoClose();
  }, ms);
}
schedule9pmAutoClose();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
}
