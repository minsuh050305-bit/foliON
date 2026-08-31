import { useState, useEffect, useRef, useCallback } from "react";

/* ---------- constants ---------- */

const HOURS = Array.from({ length: 16 }, (_, i) => i + 8); // 8..23
const SLOTS = ["00", "10", "20", "30", "40", "50"];
const PRESET_COLORS = [
  "#B89A5A", // ink gold (accent)
  "#263653", // ink navy
  "#71809A", // ink slate
  "#17243A", // ink deep navy
];

function toDateStr(d) {
  // Local-time formatter — avoids the UTC shift that toISOString() introduces
  // in timezones ahead of UTC (e.g. KST), which was causing dates to drift.
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function todayStr() {
  return toDateStr(new Date());
}
function addDays(dateStr, n) {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + n);
  return toDateStr(d);
}
function weekDates(dateStr) {
  // Monday–Sunday week (월화수목금토일)
  const d = new Date(dateStr + "T00:00:00");
  const day = d.getDay(); // 0 = Sun
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(d);
  monday.setDate(d.getDate() + diffToMonday);
  return Array.from({ length: 7 }, (_, i) => {
    const dd = new Date(monday);
    dd.setDate(monday.getDate() + i);
    return toDateStr(dd);
  });
}
function minutesToLabel(min) {
  if (!min) return "0분";
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h && m) return `${h}시간 ${m}분`;
  if (h) return `${h}시간`;
  return `${m}분`;
}
function fmtDate(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  const days = ["일", "월", "화", "수", "목", "금", "토"];
  return `${d.getMonth() + 1}/${d.getDate()} (${days[d.getDay()]})`;
}
function uid() {
  return Math.random().toString(36).slice(2, 10);
}

/* ---------- storage helpers ---------- */

async function loadKey(key, fallback) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await window.storage.get(key, false);
      if (!res) return fallback;
      return JSON.parse(res.value);
    } catch (e) {
      if (attempt === 1) return fallback;
    }
  }
  return fallback;
}
async function saveKey(key, value) {
  try {
    await window.storage.set(key, JSON.stringify(value), false);
  } catch (e) {
    console.error("save failed", key, e);
  }
}

/* ---------- main component ---------- */

export default function StudyPlanner() {
  const [ready, setReady] = useState(false);
  const [subjects, setSubjects] = useState([]);
  const [date, setDate] = useState(todayStr());
  const [tab, setTab] = useState("routine"); // routine | library | stats
  const [dayData, setDayData] = useState({ tasks: [] });
  const [timeData, setTimeData] = useState({});
  const [loadingDay, setLoadingDay] = useState(true);
  // In-session cache of edited days, keyed by date. Once a date has been
  // loaded/edited this session, revisiting it is always served from here
  // instead of re-reading storage, so a save that hasn't fully propagated
  // yet can never make a just-made edit appear to "disappear".
  const dayCacheRef = useRef({});

  // init: load subjects once
  useEffect(() => {
    (async () => {
      const s = await loadKey("subjects", null);
      if (s) {
        setSubjects(s);
      } else {
        const defaults = [
          { id: uid(), name: "국어", color: PRESET_COLORS[0] },
          { id: uid(), name: "수학", color: PRESET_COLORS[1] },
          { id: uid(), name: "영어", color: PRESET_COLORS[3] },
          { id: uid(), name: "탐구", color: PRESET_COLORS[2] },
        ];
        setSubjects(defaults);
        await saveKey("subjects", defaults);
      }
      setReady(true);
    })();
  }, []);

  const persistSubjects = async (next) => {
    setSubjects(next);
    await saveKey("subjects", next);
  };

  // load day whenever date changes (after subjects ready)
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    (async () => {
      const cached = dayCacheRef.current[date];
      if (cached) {
        setDayData(cached.dayData);
        setTimeData(cached.timeData);
        setLoadingDay(false);
        return;
      }

      setLoadingDay(true);
      const dKey = `day:${date}`;
      let existing = await loadKey(dKey, null);

      if (!existing) {
        // build fresh day; pull forward incomplete tasks from previous day
        const prevKey = `day:${addDays(date, -1)}`;
        const prevCached = dayCacheRef.current[addDays(date, -1)];
        const prevDay = prevCached ? prevCached.dayData : await loadKey(prevKey, null);
        let carried = [];
        if (prevDay && prevDay.tasks) {
          const incomplete = prevDay.tasks.filter(
            (t) => t.status === "x" && !t.carriedApplied
          );
          if (incomplete.length) {
            carried = incomplete.map((t) => ({
              id: uid(),
              subjectId: t.subjectId,
              book: t.book,
              detail: t.detail,
              status: null,
              carriedFrom: prevDay.dateLabel || addDays(date, -1),
            }));
            const updatedPrev = {
              ...prevDay,
              tasks: prevDay.tasks.map((t) =>
                t.status === "x" ? { ...t, carriedApplied: true } : t
              ),
            };
            await saveKey(prevKey, updatedPrev);
            if (prevCached) {
              dayCacheRef.current[addDays(date, -1)] = {
                ...prevCached,
                dayData: updatedPrev,
              };
            }
          }
        }
        existing = { tasks: carried };
        await saveKey(dKey, existing);
      }

      const tKey = `time:${date}`;
      const tData = await loadKey(tKey, {});

      if (!cancelled) {
        dayCacheRef.current[date] = { dayData: existing, timeData: tData };
        setDayData(existing);
        setTimeData(tData);
        setLoadingDay(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [date, ready]);

  const persistDay = async (next) => {
    setDayData(next);
    dayCacheRef.current[date] = {
      dayData: next,
      timeData: dayCacheRef.current[date]?.timeData ?? timeData,
    };
    await saveKey(`day:${date}`, next);
  };
  const persistTime = async (next) => {
    setTimeData(next);
    dayCacheRef.current[date] = {
      dayData: dayCacheRef.current[date]?.dayData ?? dayData,
      timeData: next,
    };
    await saveKey(`time:${date}`, next);
  };

  const fontsLink = (
    <link
      href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600&family=Lora:ital,wght@0,400;0,500;0,600;1,400&family=Gowun+Batang:wght@400;700&family=Noto+Sans+KR:wght@400;500;700&display=swap"
      rel="stylesheet"
    />
  );

  if (!ready) {
    return (
      <div style={styles.loadingWrap}>
        {fontsLink}
        <style>{globalCss}</style>
        불러오는 중…
      </div>
    );
  }

  const goDay = (d) => {
    setDate(d);
    setTab("routine");
  };

  return (
    <div style={styles.app}>
      {fontsLink}
      <style>{globalCss}</style>

      <AppHeader
        onClick={() => {
          setDate(todayStr());
          setTab("routine");
        }}
      />

      <div style={styles.screenBody}>
        {tab === "library" && (
          <LibraryPanel
            selectedDate={date}
            onOpenDay={goDay}
            cache={dayCacheRef.current}
          />
        )}
        {tab === "routine" && (
          <RoutinePage
            date={date}
            setDate={setDate}
            subjects={subjects}
            onSubjectsChange={persistSubjects}
            dayData={dayData}
            onChange={persistDay}
            timeData={timeData}
            onChangeTime={persistTime}
            loading={loadingDay}
          />
        )}
        {tab === "stats" && (
          <StatsScreen
            subjects={subjects}
            date={date}
            loading={loadingDay}
            cache={dayCacheRef.current}
          />
        )}
      </div>

      <BottomNav tab={tab} setTab={setTab} />
    </div>
  );
}

/* ---------- app header (persistent logo) ---------- */

function AppHeader({ onClick }) {
  return (
    <button style={styles.appHeader} onClick={onClick}>
      <FolionMark size={32} />
      <div style={styles.appHeaderWordmark}>
        foli<span style={styles.appHeaderStarWrap}>ON<Sparkle style={styles.appHeaderStar} /></span>
      </div>
    </button>
  );
}

function FolionMark({ size = 28 }) {
  return (
    <svg width={size} height={size * 1.22} viewBox="0 0 64 78" fill="none">
      <circle cx="13" cy="10" r="3.4" stroke="var(--color-text)" strokeWidth="2" />
      <rect x="8" y="12" width="9" height="58" rx="2" fill="var(--color-text)" />
      <path
        d="M17 12 L55 5 L55 70 L21 74 L17 68 Z"
        fill="none"
        stroke="var(--color-text)"
        strokeWidth="2.2"
        strokeLinejoin="round"
      />
      <path d="M28 68 C19 64 17 51 19 39 C24 43 28 47 28 56 Z" fill="var(--color-neutral-700)" />
      <path d="M28 68 C37 64 39 51 37 39 C32 43 28 47 28 56 Z" fill="var(--color-neutral-700)" />
      <path
        d="M31 18 L33 24 L39 26 L33 28 L31 34 L29 28 L23 26 L29 24 Z"
        fill="var(--color-accent)"
      />
    </svg>
  );
}

function Sparkle({ style }) {
  return (
    <svg width="9" height="9" viewBox="0 0 24 24" style={style}>
      <path
        d="M12 2 L14.2 9.8 L22 12 L14.2 14.2 L12 22 L9.8 14.2 L2 12 L9.8 9.8 Z"
        fill="var(--color-accent)"
      />
    </svg>
  );
}

/* ---------- bottom navigation ---------- */

const NAV_ITEMS = [
  { key: "library", label: "기록", icon: "library" },
  { key: "routine", label: "오늘", icon: "routine" },
  { key: "stats", label: "통계", icon: "stats" },
];

function NavIcon({ name }) {
  const common = { width: 17, height: 17, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round", strokeLinejoin: "round" };
  switch (name) {
    case "home":
      return (
        <svg {...common}>
          <path d="M3 10.5 12 3l9 7.5" />
          <path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5" />
        </svg>
      );
    case "routine":
      return (
        <svg {...common}>
          <rect x="4" y="4" width="16" height="16" rx="2" />
          <path d="m9 12 2 2 4-4" />
        </svg>
      );
    case "library":
      return (
        <svg {...common}>
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" />
        </svg>
      );
    case "stats":
      return (
        <svg {...common}>
          <path d="M4 20V10" />
          <path d="M12 20V4" />
          <path d="M20 20v-6" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none" />
          <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
          <circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none" />
        </svg>
      );
  }
}

function BottomNav({ tab, setTab }) {
  return (
    <div style={styles.bottomNav}>
      {NAV_ITEMS.map((item) => {
        const active = tab === item.key;
        return (
          <button
            key={item.key}
            onClick={() => setTab(item.key)}
            style={{
              ...styles.navItem,
              ...(active ? styles.navItemActive : {}),
            }}
          >
            <NavIcon name={item.icon} />
            <span style={styles.navItemLabel}>{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ---------- routine screen date strip header ---------- */

function RoutinePage({
  date,
  setDate,
  subjects,
  onSubjectsChange,
  dayData,
  onChange,
  timeData,
  onChangeTime,
  loading,
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={styles.panel}>
        <PlanDateNav date={date} setDate={setDate} />

        <SectionHeader icon="leaf" ko="계획" en="PLAN" />

        <PlanProgress date={date} dayData={dayData} />

        <PlanPanel
          key={date}
          date={date}
          subjects={subjects}
          onSubjectsChange={onSubjectsChange}
          dayData={dayData}
          onChange={onChange}
          loading={loading}
        />
      </div>

      <div style={styles.panel}>
        <SectionHeader icon="clock" ko="시간 기록" en="TIME" />
        <TimePanel
          key={date}
          subjects={subjects}
          timeData={timeData}
          onChange={onChangeTime}
          loading={loading}
        />
      </div>
    </div>
  );
}

function PlanDateNav({ date, setDate }) {
  const d = new Date(date + "T00:00:00");
  const days = ["일", "월", "화", "수", "목", "금", "토"];
  return (
    <div style={styles.planDateRowBig}>
      <button style={styles.navBtn} onClick={() => setDate(addDays(date, -1))}>
        ‹
      </button>
      <div style={styles.planDateCenterBig}>
        <span style={styles.planDateBigText}>
          {d.getMonth() + 1}월 {d.getDate()}일
        </span>
        <span style={styles.planDateWeekdayText}>{days[d.getDay()]}요일</span>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          style={styles.dateInput}
        />
      </div>
      <button style={styles.navBtn} onClick={() => setDate(addDays(date, 1))}>
        ›
      </button>
    </div>
  );
}

function PlanProgress({ date, dayData }) {
  const [streak, setStreak] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let count = 0;
      let cursor = date;
      for (let i = 0; i < 60; i++) {
        const rec = await loadKey(`day:${cursor}`, null);
        if (rec && rec.tasks && rec.tasks.length > 0 && rec.tasks.every((t) => t.status === "o")) {
          count++;
          cursor = addDays(cursor, -1);
        } else {
          break;
        }
      }
      if (!cancelled) setStreak(count);
    })();
    return () => {
      cancelled = true;
    };
  }, [date, dayData]);

  const tasks = dayData?.tasks || [];
  const total = tasks.length;
  const done = tasks.filter((t) => t.status === "o").length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const completed = total > 0 && done === total;

  return (
    <div style={{ marginBottom: 18 }}>
      <div style={styles.progressTopRow}>
        <div style={styles.progressFractionRow}>
          <span style={styles.progressFraction}>{done}</span>
          <span style={styles.progressFractionSlash}>/ {total}</span>
          <span style={styles.progressLabel}>오늘 수행한 계획</span>
        </div>
        <div style={styles.progressRight}>
          {completed && <span style={styles.completedTag}>COMPLETED</span>}
          {streak !== null && streak > 0 && (
            <span style={styles.bestTag}>BEST · {streak}일</span>
          )}
        </div>
      </div>
      <div style={styles.progressTrack}>
        <div style={{ ...styles.progressFill, width: `${pct}%` }} />
      </div>
    </div>
  );
}

function SectionHeader({ icon, ko, en, compact }) {
  return (
    <div style={{ ...styles.sectionHeaderRow, ...(compact ? { marginBottom: 0 } : {}) }}>
      {icon === "leaf" ? <LeafIcon /> : icon === "library" ? <BookIcon /> : icon === "stats" ? <StatsIcon /> : <ClockIcon />}
      <span style={styles.sectionHeaderKo}>{ko}</span>
      <span style={styles.sectionHeaderEn}>{en}</span>
      {!compact && <span style={styles.sectionHeaderRule} />}
    </div>
  );
}

function LeafIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 20A7 7 0 0 1 4 13c0-5 4-9 9-9h1v1c0 5-4 9-9 9Z" />
      <path d="M4 20 13 11" />
    </svg>
  );
}
function ClockIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 3" />
    </svg>
  );
}
function BookIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" />
    </svg>
  );
}
function StatsIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 20V10" />
      <path d="M12 20V4" />
      <path d="M20 20v-6" />
    </svg>
  );
}
function CalendarIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 6, verticalAlign: -3 }}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M8 3v4M16 3v4M3 10h18" />
    </svg>
  );
}

/* ---------- library (서재 → 책 → 페이지) ---------- */

const MONTH_NAMES_EN = [
  "JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE",
  "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER",
];
const WEEKDAY_LABELS_EN = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
const WEEKDAY_LABELS_KO = ["일", "월", "화", "수", "목", "금", "토"];

function monthKeyOf(dateStr) {
  return dateStr.slice(0, 7); // "YYYY-MM"
}

function monthWeeks(ym) {
  const [y, m] = ym.split("-").map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const first = `${ym}-01`;
  const last = `${ym}-${String(daysInMonth).padStart(2, "0")}`;
  const firstMonday = weekDates(first)[0];
  const lastSunday = weekDates(last)[6];
  const weeks = [];
  let cursor = firstMonday;
  let guard = 0;
  while (cursor <= lastSunday && guard < 8) {
    weeks.push(weekDates(cursor));
    cursor = addDays(cursor, 7);
    guard++;
  }
  return weeks;
}

function LibraryPanel({ selectedDate, onOpenDay, cache }) {
  const [view, setView] = useState("shelf"); // shelf | book
  const [month, setMonth] = useState(monthKeyOf(selectedDate));

  return view === "shelf" ? (
    <LibraryShelf
      cache={cache}
      onOpenBook={(ym) => {
        setMonth(ym);
        setView("book");
      }}
    />
  ) : (
    <LibraryBook
      month={month}
      onBack={() => setView("shelf")}
      onOpenDay={onOpenDay}
      cache={cache}
    />
  );
}

function LibraryShelf({ onOpenBook, cache }) {
  const [books, setBooks] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let dayKeys = [];
      try {
        const res = await window.storage.list("day:", false);
        dayKeys = res?.keys || [];
      } catch {
        dayKeys = [];
      }
      const currentMonth = monthKeyOf(todayStr());
      const months = new Set(dayKeys.map((k) => k.replace("day:", "").slice(0, 7)));
      months.add(currentMonth);

      const list = Array.from(months).sort().reverse();
      const withStats = await Promise.all(
        list.map(async (ym) => {
          let recordedDays = 0;
          let completedDays = 0;

          if (ym === currentMonth) {
            // Read each day of the current month directly (get() is
            // read-after-write consistent) instead of relying on list(),
            // which can lag behind a just-written "day:" key.
            const [yy, mm] = ym.split("-").map(Number);
            const daysInMonth = new Date(yy, mm, 0).getDate();
            const dates = Array.from({ length: daysInMonth }, (_, i) =>
              `${ym}-${String(i + 1).padStart(2, "0")}`
            );
            await Promise.all(
              dates.map(async (ds) => {
                const cached = cache && cache[ds];
                const data = cached ? cached.dayData : await loadKey(`day:${ds}`, null);
                if (data && data.tasks && data.tasks.length > 0) {
                  recordedDays++;
                  if (data.tasks.every((t) => t.status === "o")) completedDays++;
                }
              })
            );
          } else {
            const dKeys = new Set(dayKeys.filter((k) => k.startsWith(`day:${ym}`)));
            if (cache) {
              Object.keys(cache).forEach((ds) => {
                if (ds.startsWith(`${ym}-`)) dKeys.add(`day:${ds}`);
              });
            }
            await Promise.all(
              Array.from(dKeys).map(async (k) => {
                const ds = k.replace("day:", "");
                const cached = cache && cache[ds];
                const data = cached ? cached.dayData : await loadKey(k, null);
                if (data && data.tasks && data.tasks.length > 0) {
                  recordedDays++;
                  if (data.tasks.every((t) => t.status === "o")) completedDays++;
                }
              })
            );
          }
          return { month: ym, recordedDays, completedDays };
        })
      );
      if (!cancelled) setBooks(withStats);
    })();
    return () => {
      cancelled = true;
    };
  }, [cache]);

  return (
    <div style={styles.shelfFrame}>
      <SectionHeader icon="library" ko="기록" en="LIBRARY" />
      <p style={styles.tagline}>
        하루를 채우고, 한 주를 기록하고, 한 달을 한 권으로.
      </p>

      {books === null ? (
        <p style={styles.hint}>불러오는 중…</p>
      ) : (
        <div style={styles.shelfGrid}>
          {books.map(({ month, recordedDays, completedDays }) => {
            const [y, m] = month.split("-").map(Number);
            return (
              <button
                key={month}
                style={styles.bookCard}
                onClick={() => onOpenBook(month)}
              >
                <span style={styles.bookCover}>
                  <span style={styles.bookRibbon} />
                  <span style={styles.bookYear}>{y}</span>
                  <span style={styles.bookMonthName}>{MONTH_NAMES_EN[m - 1]}</span>
                  <span style={styles.bookStat}>
                    {recordedDays > 0
                      ? `${recordedDays}일 기록 · 완료 ${completedDays}일`
                      : "아직 기록 없음"}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function LibraryBook({ month, onBack, onOpenDay, cache }) {
  const [weeksData, setWeeksData] = useState(null);
  const [y, m] = month.split("-").map(Number);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setWeeksData(null);
      const weeks = monthWeeks(month);
      const result = await Promise.all(
        weeks.map(async (week) => {
          const days = await Promise.all(
            week.map(async (ds) => {
              const inMonth = monthKeyOf(ds) === month;
              const cached = cache && cache[ds];
              const data = !inMonth ? null : cached ? cached.dayData : await loadKey(`day:${ds}`, null);
              const time = !inMonth ? {} : cached ? cached.timeData || {} : await loadKey(`time:${ds}`, {});
              const tasks = data?.tasks || [];
              return {
                date: ds,
                inMonth,
                tasks,
                minutes: Object.keys(time).length * 10,
              };
            })
          );
          return { start: week[0], end: week[6], days };
        })
      );
      if (!cancelled) setWeeksData(result);
    })();
    return () => {
      cancelled = true;
    };
  }, [month, cache]);

  return (
    <div style={styles.panel}>
      <button style={styles.backLink} onClick={onBack}>
        ‹ 서재로
      </button>

      <div style={styles.bookCoverHeader}>
        <span style={styles.bookCoverYear}>{y}</span>
        <h2 style={styles.bookCoverTitle}>{MONTH_NAMES_EN[m - 1]}</h2>
      </div>

      {weeksData === null ? (
        <p style={styles.hint}>불러오는 중…</p>
      ) : (
        <>
          <div style={styles.calWeekdayRow}>
            {WEEKDAY_LABELS_EN.map((w) => (
              <span key={w} style={styles.calWeekdayLabel}>
                {w}
              </span>
            ))}
          </div>
          <div style={styles.calGrid}>
            {weeksData.flatMap((week) =>
              week.days.map((day) => {
                const total = day.tasks.length;
                const done = day.tasks.filter((t) => t.status === "o").length;
                const full = day.inMonth && total > 0 && done === total;
                const partial = day.inMonth && total > 0 && done > 0 && !full;
                const dateNum = new Date(day.date + "T00:00:00").getDate();
                return (
                  <button
                    key={day.date}
                    onClick={() => onOpenDay(day.date)}
                    disabled={!day.inMonth}
                    style={{
                      ...styles.calCell,
                      ...(full ? styles.calCellGlow : {}),
                      ...(partial ? styles.calCellPartial : {}),
                      opacity: day.inMonth ? 1 : 0.25,
                      cursor: day.inMonth ? "pointer" : "default",
                    }}
                  >
                    <span style={styles.calDayNum}>{dateNum}</span>
                    {day.inMonth && day.minutes > 0 && (
                      <span style={styles.calDayMinutes}>{minutesToLabel(day.minutes)}</span>
                    )}
                  </button>
                );
              })
            )}
          </div>
          <p style={styles.hint}>
            그날 계획을 전부 O로 마치면 페이지가 환하게 빛나요. 날짜를 누르면 그날 계획으로
            이동합니다.
          </p>
        </>
      )}
    </div>
  );
}

function fmtShort(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/* ---------- subjects panel ---------- */

function SubjectsPanel({ subjects, onChange, embedded }) {
  const [name, setName] = useState("");
  const [color, setColor] = useState(PRESET_COLORS[0]);

  const add = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const next = [...subjects, { id: uid(), name: trimmed, color }];
    onChange(next);
    setName("");
    setColor(PRESET_COLORS[(subjects.length + 1) % PRESET_COLORS.length]);
  };

  const remove = (id) => {
    onChange(subjects.filter((s) => s.id !== id));
  };

  const recolor = (id, c) => {
    onChange(subjects.map((s) => (s.id === id ? { ...s, color: c } : s)));
  };

  const rename = (id, n) => {
    onChange(subjects.map((s) => (s.id === id ? { ...s, name: n } : s)));
  };

  return (
    <div style={embedded ? undefined : styles.panel}>
      <p style={styles.hint}>
        과목마다 고정 색을 정해두면, 계획표와 타임 플래너에서 같은 색으로 표시돼요.
        일년 내내 색을 바꾸지 않는 걸 추천해요.
      </p>

      <div style={styles.subjectList}>
        {subjects.map((s) => (
          <div key={s.id} style={styles.subjectRow}>
            <input
              type="color"
              value={s.color}
              onChange={(e) => recolor(s.id, e.target.value)}
              style={styles.colorSwatch}
            />
            <input
              value={s.name}
              onChange={(e) => rename(s.id, e.target.value)}
              style={styles.subjectNameInput}
            />
            <button style={styles.removeBtn} onClick={() => remove(s.id)}>
              삭제
            </button>
          </div>
        ))}
        {subjects.length === 0 && (
          <p style={styles.emptyText}>아직 등록한 과목이 없어요.</p>
        )}
      </div>

      <div style={styles.addRow}>
        <input
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          style={styles.colorSwatch}
        />
        <input
          placeholder="새 과목 이름 (예: 국어)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          style={styles.subjectNameInput}
        />
        <button style={styles.addBtn} onClick={add}>
          + 추가
        </button>
      </div>
    </div>
  );
}

/* ---------- daily plan panel ---------- */

function PlanPanel({ date, subjects, onSubjectsChange, dayData, onChange, loading }) {
  const [subjectId, setSubjectId] = useState(subjects[0]?.id || "");
  const [book, setBook] = useState("");
  const [detail, setDetail] = useState("");
  const [showSubjectManage, setShowSubjectManage] = useState(subjects.length === 0);

  useEffect(() => {
    if (!subjectId && subjects[0]) setSubjectId(subjects[0].id);
  }, [subjects, subjectId]);

  const tasks = dayData.tasks || [];
  const carried = tasks.filter((t) => t.carriedFrom && t.status !== "o");
  const normal = tasks.filter((t) => !(t.carriedFrom && t.status !== "o"));

  const subjectOf = (id) => subjects.find((s) => s.id === id);

  const addTask = () => {
    const b = book.trim();
    const d = detail.trim();
    if ((!b && !d) || !subjectId) return;
    const next = {
      ...dayData,
      tasks: [
        ...tasks,
        { id: uid(), subjectId, book: b, detail: d, status: null },
      ],
    };
    onChange(next);
    setBook("");
    setDetail("");
  };

  const setStatus = (id, status) => {
    const next = {
      ...dayData,
      tasks: tasks.map((t) =>
        t.id === id ? { ...t, status: t.status === status ? null : status } : t
      ),
    };
    onChange(next);
  };

  const removeTask = (id) => {
    onChange({ ...dayData, tasks: tasks.filter((t) => t.id !== id) });
  };

  if (loading) {
    return <p style={styles.hint}>불러오는 중…</p>;
  }

  return (
    <div>
      <div style={styles.table}>
        {carried.length > 0 && (
          <div style={styles.carriedBlock}>
            {carried.map((t) => (
              <TaskRow
                key={t.id}
                task={t}
                subject={subjectOf(t.subjectId)}
                carried
                onStatus={setStatus}
                onRemove={removeTask}
              />
            ))}
          </div>
        )}
        {normal.map((t) => (
          <TaskRow
            key={t.id}
            task={t}
            subject={subjectOf(t.subjectId)}
            onStatus={setStatus}
            onRemove={removeTask}
          />
        ))}
        {tasks.length === 0 && (
          <p style={styles.emptyText}>이 날짜에 등록된 계획이 없어요.</p>
        )}
      </div>

      <div style={styles.routineAddBox}>
        <div style={styles.subjectSetupHeader}>
          <span style={styles.smallCapsLabel}>과목/카테고리</span>
          <button
            style={styles.gearBtn}
              onClick={() => setShowSubjectManage((v) => !v)}
            >
              {showSubjectManage ? "닫기" : "편집"}
            </button>
          </div>

          {showSubjectManage ? (
            <div style={{ marginBottom: 16 }}>
              <SubjectsPanel subjects={subjects} onChange={onSubjectsChange} embedded />
            </div>
          ) : (
            <div style={styles.chipRow}>
              {subjects.map((s) => {
                const active = subjectId === s.id;
                return (
                  <button
                    key={s.id}
                    onClick={() => setSubjectId(s.id)}
                    style={{
                      ...styles.paletteChip,
                      background: active ? hexToRgba(s.color, 0.16) : "transparent",
                      borderColor: active ? s.color : "var(--color-divider)",
                    }}
                  >
                    <span
                      style={{
                        width: 9,
                        height: 9,
                        borderRadius: "50%",
                        flexShrink: 0,
                        background: hexToRgba(s.color, 0.34),
                        border: `1px solid ${s.color}`,
                      }}
                    />
                    {s.name}
                  </button>
                );
              })}
            </div>
          )}

          {subjects.length > 0 && !showSubjectManage && (
            <>
              <span style={styles.smallCapsLabel}>계획 이름</span>
              <input
                placeholder="예) 영어 단어 암기"
                value={book}
                onChange={(e) => setBook(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addTask()}
                style={{ ...styles.contentInput, width: "100%", marginBottom: 10 }}
              />
              <span style={styles.smallCapsLabel}>상세 내용</span>
              <input
                placeholder="예) 120~126pg / 유형 12"
                value={detail}
                onChange={(e) => setDetail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addTask()}
                style={{ ...styles.contentInput, width: "100%", marginBottom: 20 }}
              />
              <button style={styles.primaryBtnNavy} onClick={addTask}>
                추가
              </button>
            </>
          )}
        </div>
    </div>
  );
}

function TaskRow({ task, subject, carried, onStatus, onRemove }) {
  const isDone = task.status === "o";
  const isFail = task.status === "x";
  const ink = subject?.color || "#71809a";
  const bg = isDone ? hexToRgba(ink, 0.13) : "transparent";
  const bookColor = isDone ? "var(--color-neutral-600)" : "var(--color-text)";
  const detailColor = "var(--color-neutral-600)";

  return (
    <div style={{ ...styles.taskRow, background: bg }}>
      <span
        style={{
          ...styles.subjectDot,
          background: hexToRgba(ink, 0.34),
          border: `1px solid ${ink}`,
        }}
        title={subject?.name}
      />
      <span style={styles.subjectLabel}>{subject?.name || "-"}</span>
      <span style={styles.taskContent}>
        {carried && !isDone && <span style={styles.carriedTag}>이월</span>}
        {task.book && (
          <span
            style={{
              color: bookColor,
              display: "block",
              textDecoration: isDone ? "line-through" : "none",
            }}
          >
            {task.book}
          </span>
        )}
        {task.detail && (
          <span style={{ color: detailColor, display: "block", fontSize: 12.5 }}>
            {task.detail}
          </span>
        )}
      </span>
      <div style={styles.statusBtns}>
        <button
          onClick={() => onStatus(task.id, "o")}
          style={{
            ...styles.circleBtn,
            ...(isDone ? styles.circleBtnActiveO : {}),
          }}
        >
          O
        </button>
        <button
          onClick={() => onStatus(task.id, "x")}
          style={{
            ...styles.circleBtn,
            ...(isFail ? styles.circleBtnActiveX : {}),
          }}
        >
          X
        </button>
        <button style={styles.deleteX} onClick={() => onRemove(task.id)}>
          ✕
        </button>
      </div>
    </div>
  );
}

/* ---------- time planner panel ---------- */

function TimePanel({ subjects, timeData, onChange, loading }) {
  const [selected, setSelected] = useState(subjects[0]?.id || null);
  const [eraser, setEraser] = useState(false);
  const painting = useRef(false);
  const paintValue = useRef(null);
  // Kept in sync with the latest timeData so rapid multi-cell drag-painting
  // always builds on the true latest state, not a stale render's snapshot.
  const timeDataRef = useRef(timeData);
  useEffect(() => {
    timeDataRef.current = timeData;
  }, [timeData]);

  useEffect(() => {
    if (!selected && subjects[0]) setSelected(subjects[0].id);
  }, [subjects, selected]);

  useEffect(() => {
    const up = () => (painting.current = false);
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
  }, []);

  const cellKey = (h, m) => `${String(h).padStart(2, "0")}:${m}`;

  const paint = useCallback(
    (key, value) => {
      const next = { ...timeDataRef.current };
      if (value === null) delete next[key];
      else next[key] = value;
      timeDataRef.current = next;
      onChange(next);
    },
    [onChange]
  );

  const startPaint = (key) => {
    const value = eraser ? null : selected;
    if (!eraser && !selected) return;
    painting.current = true;
    paintValue.current = value;
    paint(key, value);
  };
  const dragOver = (key) => {
    if (painting.current) paint(key, paintValue.current);
  };

  // per-subject minute totals (today), shown on the palette chips
  const totals = {};
  subjects.forEach((s) => (totals[s.id] = 0));
  Object.values(timeData).forEach((sid) => {
    if (totals[sid] !== undefined) totals[sid] += 10;
  });

  if (loading) return <p style={styles.hint}>불러오는 중…</p>;

  return (
    <div>
      {subjects.length === 0 ? (
        <p style={styles.hint}>먼저 위 '오늘 계획'의 과목 설정에서 과목을 추가해주세요.</p>
      ) : (
        <>
          <div style={styles.paletteRow}>
            {subjects.map((s) => {
              const active = selected === s.id && !eraser;
              return (
                <button
                  key={s.id}
                  onClick={() => {
                    setSelected(s.id);
                    setEraser(false);
                  }}
                  style={{
                    ...styles.paletteChip,
                    background: active ? hexToRgba(s.color, 0.14) : "transparent",
                    borderColor: active ? s.color : "var(--color-divider)",
                  }}
                >
                  <span
                    style={{
                      width: 9,
                      height: 9,
                      borderRadius: "50%",
                      flexShrink: 0,
                      background: hexToRgba(s.color, 0.34),
                      border: `1px solid ${s.color}`,
                    }}
                  />
                  {s.name}
                  <span style={styles.paletteMinutes}>
                    {totals[s.id] ? `${totals[s.id]}분` : ""}
                  </span>
                </button>
              );
            })}
            <button
              onClick={() => setEraser(true)}
              style={{
                ...styles.paletteChip,
                background: eraser ? "var(--color-neutral-200)" : "transparent",
                borderColor: eraser ? "var(--color-neutral-700)" : "var(--color-divider)",
              }}
            >
              지우개
            </button>
          </div>
          <p style={styles.hint}>
            색을 고른 뒤, 아래 칸을 클릭하거나 드래그해서 공부한 시간을 칠해보세요. (10분 단위)
          </p>

          <div
            style={styles.timeGrid}
            onMouseLeave={() => (painting.current = false)}
          >
            {HOURS.map((h) => (
              <div key={h} style={styles.timeGridRow}>
                <div style={styles.timeGridHourLabel}>{h}</div>
                <div style={styles.timeGridCells}>
                  {SLOTS.map((m) => {
                    const key = cellKey(h, m);
                    const sid = timeData[key];
                    const subj = subjects.find((s) => s.id === sid);
                    return (
                      <div
                        key={key}
                        onMouseDown={() => startPaint(key)}
                        onMouseEnter={() => dragOver(key)}
                        style={{
                          ...styles.timeCell,
                          background: subj ? hexToRgba(subj.color, 0.42) : "transparent",
                          boxShadow: subj ? `inset 0 -2px 0 ${subj.color}` : "none",
                        }}
                      />
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/* ---------- planner analysis panel (separate section) ---------- */

/* ---------- stats data helpers ---------- */

async function aggregateDatesDirect(dates, cache) {
  // `cache` = { [date]: { dayData, timeData } } — the in-session cache of
  // every date already loaded/edited this session. Using it instead of a
  // storage round-trip means just-made edits always show up immediately,
  // regardless of storage read-after-write timing.
  const results = await Promise.all(
    dates.map(async (d) => {
      let time;
      let day;
      const cached = cache && cache[d];
      if (cached) {
        time = cached.timeData || {};
        day = cached.dayData || null;
      } else {
        [time, day] = await Promise.all([
          loadKey(`time:${d}`, {}),
          loadKey(`day:${d}`, null),
        ]);
      }
      const mins = Object.keys(time).length * 10;
      const tasks = day?.tasks || [];
      return {
        mins,
        time,
        done: tasks.filter((t) => t.status === "o").length,
        total: tasks.length,
      };
    })
  );
  let totalMinutes = 0;
  let done = 0;
  let total = 0;
  const perSubject = {};
  const perDate = results.map((r) => r.mins);
  results.forEach((r) => {
    totalMinutes += r.mins;
    done += r.done;
    total += r.total;
    Object.values(r.time).forEach((sid) => {
      perSubject[sid] = (perSubject[sid] || 0) + 10;
    });
  });
  return { totalMinutes, perDate, perSubject, done, total };
}

async function aggregateYear(year, cache) {
  let timeKeys = [];
  let dayKeys = [];
  try {
    const [timeRes, dayRes] = await Promise.all([
      window.storage.list("time:", false),
      window.storage.list("day:", false),
    ]);
    timeKeys = (timeRes?.keys || []).filter((k) => k.startsWith(`time:${year}-`));
    dayKeys = (dayRes?.keys || []).filter((k) => k.startsWith(`day:${year}-`));
  } catch {
    timeKeys = [];
    dayKeys = [];
  }

  // list() can lag behind a just-written key, so the current month (the
  // one most likely to have just-recorded data) is read directly instead
  // of relying on the list()-derived key set.
  const currentMonth = monthKeyOf(todayStr());
  const currentYear = currentMonth.slice(0, 4);
  const skipMonthKey = currentYear === String(year) ? currentMonth : null;
  if (skipMonthKey) {
    timeKeys = timeKeys.filter((k) => !k.startsWith(`time:${skipMonthKey}`));
    dayKeys = dayKeys.filter((k) => !k.startsWith(`day:${skipMonthKey}`));
  }

  // list() can also simply miss a just-written key it hasn't indexed yet;
  // make sure every cached date for this year is represented even if
  // list() didn't return it.
  if (cache) {
    const coveredDay = new Set(dayKeys.map((k) => k.replace("day:", "")));
    const coveredTime = new Set(timeKeys.map((k) => k.replace("time:", "")));
    Object.keys(cache).forEach((ds) => {
      if (!ds.startsWith(`${year}-`)) return;
      if (skipMonthKey && ds.startsWith(skipMonthKey)) return;
      if (!coveredDay.has(ds)) dayKeys.push(`day:${ds}`);
      if (!coveredTime.has(ds)) timeKeys.push(`time:${ds}`);
    });
  }

  const monthMinutes = Array(12).fill(0);
  let totalMinutes = 0;
  const perSubject = {};
  await Promise.all(
    timeKeys.map(async (k) => {
      const ds = k.replace("time:", "");
      const monthIdx = parseInt(ds.slice(5, 7), 10) - 1;
      const cached = cache && cache[ds];
      const time = cached ? cached.timeData || {} : await loadKey(k, {});
      const mins = Object.keys(time).length * 10;
      if (monthIdx >= 0 && monthIdx < 12) monthMinutes[monthIdx] += mins;
      totalMinutes += mins;
      Object.values(time).forEach((sid) => {
        perSubject[sid] = (perSubject[sid] || 0) + 10;
      });
    })
  );

  let done = 0;
  let total = 0;
  await Promise.all(
    dayKeys.map(async (k) => {
      const ds = k.replace("day:", "");
      const cached = cache && cache[ds];
      const data = cached ? cached.dayData : await loadKey(k, null);
      const tasks = data?.tasks || [];
      done += tasks.filter((t) => t.status === "o").length;
      total += tasks.length;
    })
  );

  if (skipMonthKey) {
    const [yy, mm] = skipMonthKey.split("-").map(Number);
    const daysInMonth = new Date(yy, mm, 0).getDate();
    const dates = Array.from(
      { length: daysInMonth },
      (_, i) => `${skipMonthKey}-${String(i + 1).padStart(2, "0")}`
    );
    const agg = await aggregateDatesDirect(dates, cache);
    monthMinutes[mm - 1] += agg.totalMinutes;
    totalMinutes += agg.totalMinutes;
    done += agg.done;
    total += agg.total;
    Object.entries(agg.perSubject).forEach(([sid, mins]) => {
      perSubject[sid] = (perSubject[sid] || 0) + mins;
    });
  }

  return { monthMinutes, totalMinutes, perSubject, done, total };
}

function addMonths(ym, n) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/* ---------- shared stats UI pieces ---------- */

function PeriodNavHeader({ label, onPrev, onNext }) {
  return (
    <div style={styles.periodNavRow}>
      <button style={styles.navBtn} onClick={onPrev}>
        ‹
      </button>
      <span style={styles.periodNavLabel}>{label}</span>
      <button style={styles.navBtn} onClick={onNext}>
        ›
      </button>
    </div>
  );
}

function BarChart({ bars }) {
  const max = Math.max(1, ...bars.map((b) => b.minutes));
  const trueMax = Math.max(...bars.map((b) => b.minutes));
  return (
    <div style={styles.weekBarsRow}>
      {bars.map((b, i) => {
        const isMax = b.minutes > 0 && b.minutes === trueMax;
        const h = Math.max(3, Math.round((b.minutes / max) * 72));
        return (
          <div key={i} style={styles.weekBarCol}>
            <span style={styles.weekBarHours}>
              {b.minutes ? (b.minutes / 60).toFixed(1) : ""}
            </span>
            <div
              style={{
                width: "100%",
                height: h,
                background: isMax ? "var(--color-accent-200)" : "var(--color-neutral-800)",
                borderTop: `1px solid ${isMax ? "var(--color-accent)" : "var(--color-neutral-800)"}`,
                borderLeft: "1px solid var(--color-divider)",
                borderRight: "1px solid var(--color-divider)",
              }}
            />
            <span style={styles.weekBarDay}>{b.label}</span>
          </div>
        );
      })}
    </div>
  );
}

function CompletedBar({ done, total, label }) {
  if (total === 0) return null;
  const pct = Math.round((done / total) * 100);
  return (
    <div style={styles.completedBlock}>
      <div style={styles.completedTopRow}>
        <span style={styles.analysisLabel}>{label}</span>
        <span style={styles.completedNums}>
          {done} / {total} <span style={{ color: "var(--color-accent)" }}>{pct}%</span>
        </span>
      </div>
      <div style={styles.completedTrack}>
        <div style={{ ...styles.completedFill, width: `${pct}%` }} />
      </div>
    </div>
  );
}

/* ---------- week / month / year stats ---------- */

function WeekStats({ subjects, date, cache }) {
  const [anchor, setAnchor] = useState(date);
  const [data, setData] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setData(null);
      const agg = await aggregateDatesDirect(weekDates(anchor), cache);
      if (!cancelled) setData(agg);
    })();
    return () => {
      cancelled = true;
    };
  }, [anchor, cache]);

  const week = weekDates(anchor);
  const label = `${fmtShort(week[0])} – ${fmtShort(week[6])}`;
  const dayLabels = ["월", "화", "수", "목", "금", "토", "일"];

  if (subjects.length === 0) {
    return <p style={styles.hint}>먼저 '계획' 탭에서 과목을 추가해주세요.</p>;
  }

  const totals = {};
  subjects.forEach((s) => (totals[s.id] = data?.perSubject[s.id] || 0));

  return (
    <>
      <PeriodNavHeader
        label={label}
        onPrev={() => setAnchor(addDays(anchor, -7))}
        onNext={() => setAnchor(addDays(anchor, 7))}
      />

      {data === null ? (
        <p style={styles.hint}>불러오는 중…</p>
      ) : (
        <>
          <div style={styles.analysisGrid}>
            <div style={styles.analysisStat}>
              <span style={styles.analysisLabel}>이 주 총 시간</span>
              <span style={styles.analysisBig}>{minutesToLabel(data.totalMinutes)}</span>
            </div>

            <div style={styles.analysisBarsBlock}>
              <span style={styles.analysisLabel}>과목별 비중</span>
              {data.totalMinutes === 0 ? (
                <p style={styles.emptyText}>기록된 시간이 없어요.</p>
              ) : (
                <PieChart subjects={subjects} totals={totals} total={data.totalMinutes} />
              )}
            </div>

            <CompletedBar done={data.done} total={data.total} label="완료한 계획" />
          </div>

          <div style={styles.weekBarsBlockLower}>
            <span style={styles.analysisLabel}>요일별 공부 시간</span>
            <BarChart bars={dayLabels.map((l, i) => ({ label: l, minutes: data.perDate[i] }))} />
          </div>
        </>
      )}
    </>
  );
}

function MonthStats({ subjects, date, cache }) {
  const [anchor, setAnchor] = useState(monthKeyOf(date));
  const [data, setData] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setData(null);
      const [y, m] = anchor.split("-").map(Number);
      const daysInMonth = new Date(y, m, 0).getDate();
      const dates = Array.from(
        { length: daysInMonth },
        (_, i) => `${anchor}-${String(i + 1).padStart(2, "0")}`
      );
      const agg = await aggregateDatesDirect(dates, cache);

      const weeks = monthWeeks(anchor);
      const weekBars = weeks.map((week, i) => {
        const mins = week.reduce((sum, d) => {
          if (monthKeyOf(d) !== anchor) return sum;
          const idx = dates.indexOf(d);
          return sum + (idx >= 0 ? agg.perDate[idx] : 0);
        }, 0);
        return { label: `${i + 1}주`, minutes: mins };
      });

      if (!cancelled) setData({ ...agg, weekBars });
    })();
    return () => {
      cancelled = true;
    };
  }, [anchor, cache]);

  const [y, m] = anchor.split("-").map(Number);
  const label = `${y}년 ${m}월`;

  if (subjects.length === 0) {
    return <p style={styles.hint}>먼저 '계획' 탭에서 과목을 추가해주세요.</p>;
  }

  const totals = {};
  subjects.forEach((s) => (totals[s.id] = data?.perSubject[s.id] || 0));

  return (
    <>
      <PeriodNavHeader
        label={label}
        onPrev={() => setAnchor(addMonths(anchor, -1))}
        onNext={() => setAnchor(addMonths(anchor, 1))}
      />

      {data === null ? (
        <p style={styles.hint}>불러오는 중…</p>
      ) : (
        <>
          <div style={styles.analysisGrid}>
            <div style={styles.analysisStat}>
              <span style={styles.analysisLabel}>이 달 총 시간</span>
              <span style={styles.analysisBig}>{minutesToLabel(data.totalMinutes)}</span>
            </div>

            <div style={styles.analysisBarsBlock}>
              <span style={styles.analysisLabel}>과목별 비중</span>
              {data.totalMinutes === 0 ? (
                <p style={styles.emptyText}>기록된 시간이 없어요.</p>
              ) : (
                <PieChart subjects={subjects} totals={totals} total={data.totalMinutes} />
              )}
            </div>

            <CompletedBar done={data.done} total={data.total} label="완료한 계획" />
          </div>

          <div style={styles.weekBarsBlockLower}>
            <span style={styles.analysisLabel}>주별 공부 시간</span>
            <BarChart bars={data.weekBars} />
          </div>
        </>
      )}
    </>
  );
}

function YearStats({ subjects, date, cache }) {
  const [anchor, setAnchor] = useState(String(new Date(date + "T00:00:00").getFullYear()));
  const [data, setData] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setData(null);
      const agg = await aggregateYear(anchor, cache);
      if (!cancelled) setData(agg);
    })();
    return () => {
      cancelled = true;
    };
  }, [anchor, cache]);

  const monthLabels = Array.from({ length: 12 }, (_, i) => `${i + 1}월`);

  if (subjects.length === 0) {
    return <p style={styles.hint}>먼저 '계획' 탭에서 과목을 추가해주세요.</p>;
  }

  const totals = {};
  subjects.forEach((s) => (totals[s.id] = data?.perSubject[s.id] || 0));

  return (
    <>
      <PeriodNavHeader
        label={`${anchor}년`}
        onPrev={() => setAnchor(String(Number(anchor) - 1))}
        onNext={() => setAnchor(String(Number(anchor) + 1))}
      />

      {data === null ? (
        <p style={styles.hint}>불러오는 중…</p>
      ) : (
        <>
          <div style={styles.analysisGrid}>
            <div style={styles.analysisStat}>
              <span style={styles.analysisLabel}>올해 총 시간</span>
              <span style={styles.analysisBig}>{minutesToLabel(data.totalMinutes)}</span>
            </div>

            <div style={styles.analysisBarsBlock}>
              <span style={styles.analysisLabel}>과목별 비중</span>
              {data.totalMinutes === 0 ? (
                <p style={styles.emptyText}>기록된 시간이 없어요.</p>
              ) : (
                <PieChart subjects={subjects} totals={totals} total={data.totalMinutes} />
              )}
            </div>

            <CompletedBar done={data.done} total={data.total} label="완료한 계획" />
          </div>

          <div style={styles.weekBarsBlockLower}>
            <span style={styles.analysisLabel}>월별 공부 시간</span>
            <BarChart
              bars={monthLabels.map((l, i) => ({ label: l, minutes: data.monthMinutes[i] }))}
            />
          </div>
        </>
      )}
    </>
  );
}

function StatsScreen({ subjects, date, loading, cache }) {
  const [period, setPeriod] = useState("week");

  if (loading) return <div style={styles.panel}>불러오는 중…</div>;

  return (
    <div style={styles.panel}>
      <SectionHeader icon="stats" ko="통계" en="STATISTICS" />

      <div style={styles.periodTabs}>
        {[
          ["week", "이번 주"],
          ["month", "이번 달"],
          ["year", "올해"],
        ].map(([key, label]) => (
          <button
            key={key}
            onClick={() => setPeriod(key)}
            style={{
              ...styles.periodTab,
              ...(period === key ? styles.periodTabActive : {}),
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {period === "week" && <WeekStats subjects={subjects} date={date} cache={cache} />}
      {period === "month" && <MonthStats subjects={subjects} date={date} cache={cache} />}
      {period === "year" && <YearStats subjects={subjects} date={date} cache={cache} />}
    </div>
  );
}

function PieChart({ subjects, totals, total }) {
  let cursor = 0;
  const segments = subjects
    .filter((s) => totals[s.id] > 0)
    .map((s) => {
      const pct = (totals[s.id] / total) * 100;
      const start = cursor;
      cursor += pct;
      return { ...s, pct, start, end: cursor };
    });

  const gradient =
    segments
      .map((seg) => `${hexToRgba(seg.color, 0.5)} ${seg.start}% ${seg.end}%`)
      .join(", ") || "var(--color-neutral-200) 0% 100%";

  return (
    <div style={styles.pieRow}>
      <div
        style={{
          ...styles.pieCircle,
          background: `conic-gradient(${gradient})`,
        }}
      >
        <div style={styles.pieHole}>
          <span style={styles.pieHoleLabel}>전체</span>
          <span style={styles.pieHoleValue}>{minutesToLabel(total)}</span>
        </div>
      </div>
      <div style={styles.pieLegend}>
        {segments.map((s, i) => (
          <div
            key={s.id}
            style={{
              ...styles.pieLegendRow,
              borderBottom: i < segments.length - 1 ? "1px solid var(--color-divider)" : "none",
            }}
          >
            <span
              style={{
                ...styles.subjectDot,
                background: hexToRgba(s.color, 0.34),
                border: `1px solid ${s.color}`,
              }}
            />
            <span style={styles.pieLegendName}>{s.name}</span>
            <span style={styles.pieLegendPct}>{Math.round(s.pct)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- helpers ---------- */

function hexToRgba(hex, alpha) {
  const h = hex.replace("#", "");
  const bigint = parseInt(
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h,
    16
  );
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/* ---------- styles ---------- */

const globalCss = `
  * { box-sizing: border-box; }
  :root {
    --color-bg: #f6f8fa;
    --color-surface: #ffffff;
    --color-surface-2: rgba(23, 36, 58, 0.03);
    --color-inset: #e2e8ee;
    --color-text: #10192b;
    --color-accent: #b89a5a;
    --color-accent-100: rgba(184, 154, 90, 0.18);
    --color-accent-200: rgba(184, 154, 90, 0.3);
    --color-accent-300: rgba(184, 154, 90, 0.46);
    --color-accent-700: #6b5322;
    --color-accent-800: #4a3a18;
    --color-divider: rgba(16, 25, 43, 0.4);
    --color-divider-strong: rgba(16, 25, 43, 0.62);
    --color-neutral-100: #eef1f4;
    --color-neutral-200: #dbe1e8;
    --color-neutral-300: #8b93a8;
    --color-neutral-400: #6b7690;
    --color-neutral-500: #4a5876;
    --color-neutral-600: #2e3c58;
    --color-neutral-700: #202e48;
    --color-neutral-800: #1c2a44;
    --color-neutral-900: #10192b;
    --font-heading: 'Cormorant Garamond', 'Gowun Batang', serif;
    --font-body: 'Lora', 'Gowun Batang', serif;
  }
  input[type="date"] { font-family: var(--font-body); }
  input[type="color"] { -webkit-appearance: none; border: none; padding: 0; width: 26px; height: 26px; border-radius: 4px; cursor: pointer; }
  input[type="color"]::-webkit-color-swatch-wrapper { padding: 0; border-radius: 4px; }
  input[type="color"]::-webkit-color-swatch { border: 1px solid var(--color-divider); border-radius: 3px; }
  ::selection { background: var(--color-accent-200); }
  ::placeholder { color: var(--color-neutral-500); }
  button:focus-visible, input:focus-visible, select:focus-visible {
    outline: 2px solid var(--color-accent); outline-offset: 2px;
  }
`;

const styles = {
  app: {
    fontFamily: "var(--font-body)",
    background: "var(--color-bg)",
    minHeight: "100vh",
    color: "var(--color-text)",
    display: "flex",
    flexDirection: "column",
  },
  loadingWrap: {
    fontFamily: "var(--font-body)",
    background: "var(--color-bg)",
    minHeight: "100%",
    padding: 40,
    color: "var(--color-neutral-600)",
  },
  appHeader: {
    position: "sticky",
    top: 0,
    zIndex: 10,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    padding: "18px 16px",
    background: "var(--color-bg)",
    border: "none",
    width: "100%",
    cursor: "pointer",
  },
  appHeaderWordmark: {
    fontFamily: "var(--font-heading)",
    fontSize: 23,
    fontWeight: 500,
    color: "var(--color-text)",
    lineHeight: 1,
  },
  appHeaderStarWrap: { position: "relative" },
  appHeaderStar: { position: "absolute", top: -8, left: 2 },
  screenBody: {
    flex: 1,
    padding: "20px 16px 24px",
    maxWidth: 640,
    width: "100%",
    margin: "0 auto",
    boxSizing: "border-box",
  },
  bottomNav: {
    position: "sticky",
    bottom: 0,
    display: "flex",
    gap: 6,
    margin: "0 14px calc(12px + env(safe-area-inset-bottom, 0px))",
    padding: 5,
    background: "var(--color-bg)",
    border: "1px solid var(--color-divider)",
    borderRadius: 14,
  },
  navItem: {
    flex: 1,
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    padding: "12px 6px",
    background: "transparent",
    border: "none",
    borderBottom: "2px solid transparent",
    borderRadius: 10,
    cursor: "pointer",
    minHeight: 46,
    color: "var(--color-neutral-400)",
  },
  navItemActive: {
    background: "var(--color-accent-100)",
    borderBottom: "2px solid var(--color-accent)",
    color: "var(--color-text)",
  },
  navItemLabel: { fontSize: 13, letterSpacing: "0.01em" },

  /* -- welcome screen -- */
  welcomeWrap: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "56px 26px 40px",
    maxWidth: 420,
    width: "100%",
    margin: "0 auto",
    boxSizing: "border-box",
    textAlign: "center",
  },
  welcomeTop: { display: "flex", alignItems: "center", justifyContent: "center", paddingTop: 20 },
  welcomeBottom: { width: "100%" },
  wordmark: {
    fontFamily: "var(--font-heading)",
    fontSize: 34,
    fontWeight: 600,
    letterSpacing: "0.02em",
    marginBottom: 14,
  },
  welcomeTagline: {
    fontSize: 14,
    lineHeight: 1.8,
    color: "var(--color-neutral-300)",
    margin: "0 0 36px",
  },
  welcomeActions: { display: "flex", flexDirection: "column", gap: 10 },
  primaryBtn: {
    background: "var(--color-accent)",
    color: "var(--color-inset)",
    border: "none",
    borderRadius: 10,
    padding: "14px 18px",
    fontSize: 14.5,
    fontWeight: 600,
    fontFamily: "var(--font-body)",
    cursor: "pointer",
    width: "100%",
  },
  primaryBtnNavy: {
    background: "var(--color-neutral-800)",
    color: "#ffffff",
    border: "none",
    borderRadius: 10,
    padding: "14px 18px",
    fontSize: 14.5,
    fontWeight: 600,
    fontFamily: "var(--font-body)",
    cursor: "pointer",
    width: "100%",
  },
  outlineBtn: {
    background: "transparent",
    color: "var(--color-text)",
    border: "1px solid var(--color-divider-strong)",
    borderRadius: 10,
    padding: "14px 18px",
    fontSize: 14.5,
    fontWeight: 500,
    fontFamily: "var(--font-body)",
    cursor: "pointer",
    width: "100%",
  },

  header: { marginBottom: 18 },
  titleRow: { display: "flex", alignItems: "baseline", gap: 8, marginBottom: 14 },
  titleMark: { fontSize: 18, color: "var(--color-accent)" },
  title: {
    fontFamily: "var(--font-heading)",
    fontSize: 27,
    fontWeight: 600,
    margin: 0,
    letterSpacing: "-0.01em",
  },
  dateRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginBottom: 14,
  },
  navBtn: {
    background: "transparent",
    border: "1px solid var(--color-divider)",
    borderRadius: 4,
    width: 34,
    height: 34,
    fontSize: 16,
    cursor: "pointer",
    color: "var(--color-text)",
  },
  dateDisplay: {
    position: "relative",
    flex: 1,
    display: "flex",
    justifyContent: "center",
  },
  dateBig: {
    fontFamily: "var(--font-heading)",
    fontSize: 19,
    fontWeight: 600,
    background: "transparent",
    border: "1px solid var(--color-divider)",
    borderRadius: 4,
    padding: "6px 18px",
  },
  dateInput: {
    position: "absolute",
    inset: 0,
    opacity: 0,
    cursor: "pointer",
    width: "100%",
  },
  todayBtn: {
    background: "transparent",
    border: "1px solid var(--color-accent)",
    borderRadius: 4,
    padding: "6px 10px",
    fontSize: 12,
    fontWeight: 500,
    cursor: "pointer",
    color: "var(--color-accent-800)",
  },
  tabs: { display: "flex", gap: 4, borderBottom: "1px solid var(--color-divider)" },
  tabBtn: {
    background: "transparent",
    border: "none",
    padding: "8px 12px",
    fontSize: 13,
    fontWeight: 500,
    fontFamily: "var(--font-body)",
    color: "var(--color-neutral-600)",
    cursor: "pointer",
    borderBottom: "2px solid transparent",
    marginBottom: -1,
    letterSpacing: "0.01em",
  },
  tabBtnActive: {
    color: "var(--color-accent-800)",
    borderBottom: "2px solid var(--color-accent)",
  },
  body: {},
  panel: {
    background: "transparent",
    border: "none",
    borderRadius: 8,
    padding: "18px 0",
  },
  hint: { fontSize: 12.5, color: "var(--color-neutral-600)", lineHeight: 1.7, margin: "0 0 14px" },
  emptyText: { fontSize: 13, color: "var(--color-neutral-500)", padding: "10px 0" },

  subjectList: { display: "flex", flexDirection: "column", gap: 0, marginBottom: 14, borderTop: "1px solid var(--color-divider)" },
  subjectRow: { display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: "1px solid var(--color-divider)" },
  colorSwatch: { flexShrink: 0 },
  subjectNameInput: {
    flex: 1,
    border: "1px solid var(--color-divider)",
    borderRadius: 4,
    padding: "8px 10px",
    fontSize: 14,
    fontFamily: "var(--font-body)",
    background: "var(--color-inset)",
    color: "var(--color-text)",
  },
  removeBtn: {
    background: "transparent",
    border: "none",
    color: "var(--color-neutral-600)",
    fontSize: 11,
    cursor: "pointer",
    padding: "4px 6px",
    letterSpacing: "0.04em",
  },
  addRow: { display: "flex", alignItems: "center", gap: 10 },
  addBtn: {
    background: "transparent",
    color: "var(--color-accent-800)",
    border: "1px solid var(--color-accent)",
    borderRadius: 4,
    padding: "9px 14px",
    fontSize: 13,
    fontWeight: 500,
    fontFamily: "var(--font-body)",
    cursor: "pointer",
    whiteSpace: "nowrap",
  },

  table: { display: "flex", flexDirection: "column", gap: 0, marginBottom: 16, borderTop: "1px solid var(--color-divider)" },
  carriedBlock: {
    display: "flex",
    flexDirection: "column",
    gap: 0,
  },
  taskRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "11px 6px",
    borderBottom: "1px solid var(--color-divider)",
  },
  subjectDot: { width: 9, height: 9, borderRadius: "50%", flexShrink: 0, boxSizing: "border-box" },
  subjectLabel: { fontSize: 11.5, color: "var(--color-neutral-600)", width: 34, flexShrink: 0 },
  taskContent: { fontSize: 14, flex: 1, lineHeight: 1.4 },
  carriedTag: {
    fontSize: 9.5,
    fontWeight: 500,
    letterSpacing: "0.1em",
    color: "var(--color-accent-700)",
    border: "1px solid var(--color-accent)",
    borderRadius: 2,
    padding: "1px 5px",
    marginRight: 6,
  },
  statusBtns: { display: "flex", alignItems: "center", gap: 5, flexShrink: 0 },
  circleBtn: {
    width: 30,
    height: 30,
    borderRadius: "50%",
    border: "1px solid var(--color-divider)",
    background: "transparent",
    fontSize: 13,
    fontWeight: 600,
    fontFamily: "var(--font-heading)",
    cursor: "pointer",
    color: "var(--color-neutral-500)",
  },
  circleBtnActiveO: {
    background: "var(--color-accent-100)",
    color: "var(--color-accent-800)",
    borderColor: "var(--color-accent)",
  },
  circleBtnActiveX: {
    background: "var(--color-neutral-200)",
    color: "var(--color-neutral-800)",
    borderColor: "var(--color-neutral-700)",
  },
  deleteX: {
    background: "transparent",
    border: "none",
    color: "var(--color-neutral-400)",
    fontSize: 12,
    cursor: "pointer",
    marginLeft: 2,
  },

  addTaskRow: { display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" },
  addTaskGroup: { display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" },
  subjectSelect: {
    border: "1px solid var(--color-divider)",
    borderRadius: 4,
    padding: "8px 6px",
    fontSize: 13,
    background: "var(--color-inset)",
    color: "var(--color-text)",
    fontFamily: "var(--font-body)",
  },
  contentInput: {
    flex: "1 1 160px",
    border: "1px solid var(--color-divider)",
    borderRadius: 4,
    padding: "8px 10px",
    fontSize: 13,
    background: "var(--color-inset)",
    color: "var(--color-text)",
    fontFamily: "var(--font-body)",
  },
  bookToggle: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    fontSize: 12,
    color: "var(--color-neutral-600)",
    whiteSpace: "nowrap",
  },

  paletteRow: { display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 },
  paletteChip: {
    borderRadius: 4,
    border: "1px solid var(--color-divider)",
    background: "transparent",
    padding: "8px 12px",
    fontSize: 13,
    fontFamily: "var(--font-body)",
    fontWeight: 500,
    cursor: "pointer",
    color: "var(--color-text)",
    display: "flex",
    alignItems: "center",
    gap: 7,
    minHeight: 40,
  },
  paletteMinutes: { fontSize: 10.5, color: "var(--color-neutral-600)" },

  timeGrid: {
    border: "1px solid var(--color-divider)",
    borderRadius: 4,
    overflow: "hidden",
    userSelect: "none",
  },
  timeGridRow: { display: "flex", borderBottom: "1px solid var(--color-divider)" },
  timeGridHourLabel: {
    width: 30,
    fontSize: 10.5,
    color: "var(--color-neutral-400)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "var(--color-inset)",
    flexShrink: 0,
    fontFamily: "var(--font-heading)",
  },
  timeGridCells: { display: "flex", flex: 1 },
  timeCell: {
    flex: 1,
    height: 26,
    borderLeft: "1px solid var(--color-divider)",
    cursor: "pointer",
  },

  sectionTitle: {
    fontFamily: "var(--font-heading)",
    fontSize: 19,
    fontWeight: 600,
    margin: "0 0 14px",
  },
  analysisGrid: {
    display: "flex",
    flexWrap: "wrap",
    gap: 0,
    borderTop: "1px solid var(--color-divider)",
  },
  analysisStat: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    flex: "1 1 130px",
    padding: "14px 0",
  },
  analysisLabel: {
    fontSize: 10,
    color: "var(--color-neutral-600)",
    letterSpacing: "0.1em",
    textTransform: "uppercase",
  },
  analysisBig: {
    fontFamily: "var(--font-heading)",
    fontSize: 30,
    fontWeight: 400,
    color: "var(--color-text)",
    fontFeatureSettings: "'tnum'",
  },
  analysisBarsBlock: {
    flex: "1 1 100%",
    display: "flex",
    flexDirection: "column",
    gap: 10,
    paddingTop: 20,
  },
  analysisBars: { display: "flex", flexDirection: "column", gap: 8 },
  barRow: { display: "flex", alignItems: "center", gap: 6 },
  barLabel: { fontSize: 12, width: 38, flexShrink: 0, color: "var(--color-text)" },
  barTrack: {
    flex: 1,
    height: 2,
    background: "var(--color-divider)",
    overflow: "hidden",
  },
  barFill: { height: "100%" },
  barPct: {
    fontSize: 12,
    color: "var(--color-neutral-600)",
    width: 32,
    textAlign: "right",
    flexShrink: 0,
    fontFamily: "var(--font-heading)",
  },

  weekBarsBlock: {
    flex: "1 1 100%",
    paddingTop: 18,
    borderTop: "1px solid var(--color-divider)",
  },
  weekBarsBlockLower: {
    marginTop: 40,
    paddingTop: 22,
    borderTop: "1px solid var(--color-divider)",
  },
  weekBarsRow: { display: "flex", alignItems: "flex-end", gap: 8, height: 100, marginTop: 14 },
  weekBarCol: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 6,
    height: "100%",
    justifyContent: "flex-end",
  },
  weekBarHours: { fontSize: 10.5, color: "var(--color-neutral-600)", fontFamily: "var(--font-heading)" },
  weekBarDay: { fontSize: 11, color: "var(--color-neutral-600)" },

  subjectSetupHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  gearBtn: {
    background: "transparent",
    border: "1px solid var(--color-divider)",
    borderRadius: 4,
    padding: "6px 10px",
    fontSize: 11.5,
    fontFamily: "var(--font-body)",
    color: "var(--color-neutral-300)",
    cursor: "pointer",
  },
  subjectSetupBox: {
    background: "var(--color-inset)",
    border: "1px solid var(--color-divider)",
    borderRadius: 4,
    padding: 14,
    marginBottom: 16,
  },

  pieRow: { display: "flex", alignItems: "center", gap: 22, flexWrap: "wrap" },
  pieCircle: {
    width: 120,
    height: 120,
    borderRadius: "50%",
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    boxShadow: "inset 0 0 0 1px var(--color-divider)",
  },
  pieHole: {
    width: 74,
    height: 74,
    borderRadius: "50%",
    background: "var(--color-bg)",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  pieHoleLabel: { fontSize: 10, color: "var(--color-neutral-600)" },
  pieHoleValue: { fontSize: 14, fontWeight: 600, color: "var(--color-text)", fontFamily: "var(--font-heading)" },
  pieLegend: { display: "flex", flexDirection: "column", gap: 0, flex: "1 1 120px" },
  pieLegendRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 12.5,
    padding: "7px 0",
    borderBottom: "1px solid var(--color-divider)",
  },
  pieLegendName: { flex: 1, color: "var(--color-text)" },
  pieLegendPct: { color: "var(--color-text)", fontSize: 14, fontFamily: "var(--font-heading)" },

  tagline: {
    fontFamily: "var(--font-heading)",
    fontStyle: "italic",
    fontSize: 14,
    color: "var(--color-neutral-400)",
    margin: "0 0 20px",
  },

  /* -- shelf frame / book cards -- */
  shelfFrame: {
    background: "transparent",
    border: "none",
    borderRadius: 8,
    padding: "18px 0",
  },
  shelfGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(112px, 1fr))",
    gap: 16,
  },
  bookCard: {
    position: "relative",
    display: "block",
    textAlign: "left",
    aspectRatio: "3 / 4",
    border: "none",
    borderRadius: 18,
    background: "var(--color-neutral-200)",
    cursor: "pointer",
    padding: 0,
    boxShadow: "0 3px 10px rgba(8, 14, 26, 0.45)",
  },
  bookCover: {
    position: "absolute",
    inset: "0 4px 4px 0",
    borderRadius: 16,
    background: "#1c2c48",
    display: "flex",
    flexDirection: "column",
    justifyContent: "flex-end",
    gap: 3,
    padding: "14px 12px",
    overflow: "hidden",
  },
  bookRibbon: {
    position: "absolute",
    top: 0,
    right: "22%",
    width: "24%",
    height: "42%",
    background: "var(--color-accent)",
    clipPath: "polygon(0 0, 100% 0, 100% 86%, 50% 100%, 0 86%)",
  },
  bookYear: {
    fontSize: 10.5,
    letterSpacing: "0.14em",
    color: "#b9c3d4",
  },
  bookMonthName: {
    fontFamily: "var(--font-heading)",
    fontSize: 20,
    fontWeight: 600,
    color: "#f6f3ec",
  },
  bookStat: {
    fontSize: 10,
    color: "#b9c3d4",
  },

  backLink: {
    background: "transparent",
    border: "none",
    color: "var(--color-accent-800)",
    fontSize: 12.5,
    cursor: "pointer",
    padding: 0,
    marginBottom: 16,
  },
  bookCoverHeader: {
    borderBottom: "1px solid var(--color-divider)",
    paddingBottom: 16,
    marginBottom: 18,
  },
  bookCoverYear: {
    display: "block",
    fontSize: 11,
    letterSpacing: "0.16em",
    color: "var(--color-accent)",
  },
  bookCoverTitle: {
    fontFamily: "var(--font-heading)",
    fontSize: 30,
    fontWeight: 600,
    margin: "4px 0 0",
  },

  calWeekdayRow: {
    display: "grid",
    gridTemplateColumns: "repeat(7, 1fr)",
    marginBottom: 6,
  },
  calWeekdayLabel: {
    textAlign: "center",
    fontSize: 9.5,
    letterSpacing: "0.08em",
    color: "var(--color-neutral-500)",
  },
  calGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(7, 1fr)",
    gap: 5,
  },
  calCell: {
    position: "relative",
    aspectRatio: "1 / 1",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    border: "1px solid var(--color-divider)",
    borderRadius: 6,
    background: "var(--color-inset)",
    fontFamily: "var(--font-body)",
  },
  calCellPartial: {
    background: "var(--color-accent-100)",
    borderColor: "var(--color-divider-strong)",
  },
  calCellGlow: {
    background: "var(--color-accent-200)",
    borderColor: "var(--color-accent)",
    boxShadow: "0 0 10px 1px rgba(184, 154, 90, 0.55), 0 0 2px rgba(255, 245, 220, 0.6)",
  },
  calDayNum: {
    fontFamily: "var(--font-heading)",
    fontSize: 14,
    fontWeight: 600,
    color: "var(--color-text)",
  },
  calDayMinutes: {
    fontSize: 8.5,
    color: "var(--color-neutral-500)",
  },

  /* -- day record header / stamp -- */
  dayHeaderCard: {
    border: "1px solid var(--color-divider)",
    borderRadius: 8,
    padding: "16px 18px",
    background: "var(--color-bg)",
  },
  dayHeaderTop: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
  },
  dayHeaderMonth: {
    fontSize: 10.5,
    letterSpacing: "0.14em",
    color: "var(--color-accent)",
  },
  dayHeaderDate: {
    fontFamily: "var(--font-heading)",
    fontSize: 40,
    lineHeight: 1,
    fontWeight: 600,
    fontFeatureSettings: "'tnum'",
    marginTop: 4,
  },
  stamp: {
    fontFamily: "var(--font-heading)",
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: "0.14em",
    color: "var(--color-accent-700)",
    border: "2px solid var(--color-accent-700)",
    borderRadius: 4,
    padding: "6px 10px",
    transform: "rotate(-6deg)",
    alignSelf: "flex-start",
    marginTop: 6,
  },
  dayHeaderStats: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 12.5,
    color: "var(--color-neutral-300)",
    marginTop: 14,
    paddingTop: 12,
    borderTop: "1px solid var(--color-divider)",
  },
  dayHeaderDot: { color: "var(--color-neutral-400)" },

  /* -- home screen -- */
  homeHeader: { display: "flex", flexDirection: "column", gap: 16 },
  homeGreetingRow: { display: "flex", alignItems: "flex-start", justifyContent: "space-between" },
  homeGreeting: { fontSize: 13, color: "var(--color-neutral-400)" },
  homeBrand: {
    fontFamily: "var(--font-heading)",
    fontSize: 26,
    fontWeight: 600,
    marginTop: 2,
  },
  homeSub: { fontSize: 12.5, color: "var(--color-neutral-400)", marginTop: 4 },
  bellIcon: {
    color: "var(--color-neutral-300)",
    padding: 6,
  },
  weekStrip: { display: "flex", justifyContent: "space-between", gap: 4 },
  weekStripDay: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 6,
    padding: "8px 0",
    border: "1px solid transparent",
    borderRadius: 8,
    background: "transparent",
    cursor: "pointer",
  },
  weekStripDayActive: {
    border: "1px solid var(--color-accent)",
    background: "var(--color-accent-100)",
  },
  weekStripLabel: { fontSize: 10, color: "var(--color-neutral-400)" },
  weekStripNum: { fontFamily: "var(--font-heading)", fontSize: 15, fontWeight: 600 },

  homeCardLabel: {
    fontSize: 10.5,
    letterSpacing: "0.14em",
    color: "var(--color-neutral-400)",
    marginBottom: 14,
  },
  todayRecordRow: { display: "flex", gap: 20, alignItems: "center" },
  todayRecordList: { flex: 1, display: "flex", flexDirection: "column", gap: 9, minWidth: 0 },
  todayRecordItem: { display: "flex", alignItems: "center", gap: 8 },
  todayRecordText: {
    flex: 1,
    fontSize: 12.5,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  checkMarkOn: { color: "var(--color-accent)", fontSize: 13 },
  checkMarkOff: { color: "var(--color-neutral-500)", fontSize: 13 },
  ringCenter: {
    position: "absolute",
    inset: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  ringPercent: { fontFamily: "var(--font-heading)", fontSize: 22, fontWeight: 600 },
  textLinkBtn: {
    display: "block",
    marginTop: 16,
    background: "transparent",
    border: "none",
    color: "var(--color-accent-700)",
    fontSize: 12.5,
    cursor: "pointer",
    padding: 0,
  },
  inlineLinkBtn: {
    background: "transparent",
    border: "none",
    color: "var(--color-accent-700)",
    fontSize: "inherit",
    cursor: "pointer",
    padding: 0,
    textDecoration: "underline",
  },
  thisWeekTotal: { fontSize: 13, color: "var(--color-neutral-300)", marginBottom: 14 },

  /* -- routine add box -- */
  routineAddBox: {
    marginTop: 18,
    border: "1px solid var(--color-divider)",
    borderRadius: 8,
    padding: 14,
    background: "var(--color-surface-2)",
  },
  smallCapsLabel: {
    display: "block",
    fontSize: 10,
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    color: "var(--color-neutral-400)",
    marginBottom: 8,
  },
  chipRow: { display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 },

  /* -- stats period tabs / completed bar -- */
  periodTabs: {
    display: "flex",
    gap: 4,
    background: "var(--color-inset)",
    borderRadius: 8,
    padding: 4,
    marginBottom: 18,
  },
  periodTab: {
    flex: 1,
    background: "transparent",
    border: "none",
    borderRadius: 6,
    padding: "8px 0",
    fontSize: 12.5,
    color: "var(--color-neutral-400)",
    cursor: "pointer",
    fontFamily: "var(--font-body)",
  },
  periodTabActive: {
    background: "var(--color-neutral-800)",
    color: "#ffffff",
    fontWeight: 600,
  },
  periodNavRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
    marginBottom: 18,
  },
  periodNavLabel: {
    fontFamily: "var(--font-heading)",
    fontSize: 18,
    fontWeight: 600,
    color: "var(--color-text)",
    minWidth: 120,
    textAlign: "center",
  },
  completedBlock: { flex: "1 1 100%", paddingTop: 18, borderTop: "1px solid var(--color-divider)" },
  completedTopRow: { display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 },
  completedNums: { fontFamily: "var(--font-heading)", fontSize: 16, fontWeight: 600 },
  completedTrack: { height: 6, borderRadius: 3, background: "var(--color-inset)", overflow: "hidden" },
  completedFill: { height: "100%", background: "var(--color-accent)" },

  /* -- routine page (date/progress/section header) -- */
  planHeaderRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    marginBottom: 14,
  },
  planDateRowBig: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
    margin: "0 0 18px",
  },
  planDateCenterBig: {
    position: "relative",
    textAlign: "center",
  },
  planDateBigText: {
    display: "block",
    fontFamily: "var(--font-heading)",
    fontSize: 30,
    fontWeight: 600,
    color: "var(--color-text)",
    lineHeight: 1.1,
  },
  planDateWeekdayText: {
    display: "block",
    fontSize: 12.5,
    color: "var(--color-neutral-500)",
    marginTop: 3,
  },
  sectionDivider: { height: 1, background: "var(--color-divider)", margin: "14px 0" },

  progressTopRow: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 8 },
  progressFractionRow: { display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" },
  progressFraction: { fontFamily: "var(--font-heading)", fontSize: 24, fontWeight: 600 },
  progressFractionSlash: { fontFamily: "var(--font-heading)", fontSize: 14, color: "var(--color-neutral-400)" },
  progressLabel: { fontSize: 12, color: "var(--color-neutral-400)", marginLeft: 4 },
  progressRight: { display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 },
  completedTag: {
    fontSize: 9.5,
    fontWeight: 700,
    letterSpacing: "0.1em",
    color: "var(--color-accent-700)",
    border: "1px solid var(--color-accent)",
    borderRadius: 2,
    padding: "2px 6px",
  },
  bestTag: {
    fontSize: 10.5,
    letterSpacing: "0.05em",
    color: "var(--color-accent)",
    fontWeight: 600,
  },
  progressTrack: { height: 6, borderRadius: 3, background: "var(--color-inset)", overflow: "hidden" },
  progressFill: { height: "100%", background: "var(--color-accent)" },

  sectionHeaderRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    color: "var(--color-accent)",
    marginBottom: 14,
  },
  sectionHeaderKo: { fontSize: 15, fontWeight: 700, color: "var(--color-text)" },
  sectionHeaderEn: {
    fontSize: 10,
    letterSpacing: "0.14em",
    color: "var(--color-neutral-500)",
  },
  sectionHeaderRule: { flex: 1, height: 1, background: "var(--color-divider)" },
};
