"use client";

import { ChangeEvent, CSSProperties, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import styles from "./page.module.css";

const START_HOUR = 6;
const END_HOUR = 23;
const SLOT_COUNT = END_HOUR - START_HOUR;
const STORAGE_KEY = "tempo-focus-state-v1";
const QUOTE_KEY = "tempo-daily-quote";
const APP_VERSION = "20260505-meals1";
const DEFAULT_THRESHOLD = 3;

type CategoryKey =
  | "deep"
  | "learning"
  | "health"
  | "family"
  | "breakfast"
  | "lunch"
  | "dinner"
  | "admin"
  | "break"
  | "distraction"
  | "sleep";

type Log = {
  activity: string;
  category: CategoryKey;
  score: number;
  loggedAt: string;
  updatedAt: string;
};

type PriorityItem = {
  id: string;
  text: string;
  done: boolean;
};

type TempoState = {
  auth: { loggedIn: boolean; email: string; loggedInAt: string };
  settings: { reminders: boolean; focusAlerts: boolean; focusThreshold: number };
  logs: Record<string, Record<string, Log>>;
  priorities: { days: Record<string, PriorityItem[]>; weeks: Record<string, PriorityItem[]> };
  selectedDate: string;
  lastReminderKey: string;
  lastFocusAlertKey: string;
};

type DayStats = {
  logged: number;
  focusHours: number;
  wasteHours: number;
  bestStreak: number;
  utilization: number;
  averageScore: number;
};

type Advice = {
  summary: string;
  suggestions: string[];
  nextBlock: string;
};

type AnalysisTab = "daily" | "weekly" | "monthly";

const categories: Record<CategoryKey, { label: string; score: number; focus?: boolean; waste?: boolean; color: string }> = {
  deep: { label: "Deep work", score: 92, focus: true, color: "#2563eb" },
  learning: { label: "Learning", score: 84, focus: true, color: "#7c3aed" },
  health: { label: "Health", score: 80, focus: true, color: "#059669" },
  family: { label: "Family", score: 76, color: "#d97706" },
  breakfast: { label: "Breakfast", score: 72, color: "#0891b2" },
  lunch: { label: "Lunch", score: 72, color: "#0d9488" },
  dinner: { label: "Dinner", score: 70, color: "#ea580c" },
  admin: { label: "Admin", score: 64, color: "#64748b" },
  break: { label: "Break", score: 68, waste: true, color: "#f59e0b" },
  distraction: { label: "Distraction", score: 18, waste: true, color: "#dc2626" },
  sleep: { label: "Sleep prep", score: 58, color: "#475569" },
};

const dayDefaults = [
  "Protect the main deep work block",
  "Move body or train",
  "Learn one useful thing",
  "Wind down before sleep",
];

const weekDefaults = [
  "Ship the highest-leverage project",
  "Keep health rhythm steady",
  "Strengthen one relationship",
  "Review money and planning",
];

const makeId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

function dateKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseDateKey(key: string) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
}

function weekKey(key: string) {
  const date = parseDateKey(key);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + 3 - ((date.getDay() + 6) % 7));
  const week1 = new Date(date.getFullYear(), 0, 4);
  const week = 1 + Math.round(((date.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
  return `${date.getFullYear()}-W${String(week).padStart(2, "0")}`;
}

function longDate(key: string) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(parseDateKey(key));
}

function hourLabel(hour: number) {
  const format = (h: number) => {
    const suffix = h >= 12 ? "PM" : "AM";
    const twelve = h % 12 || 12;
    return `${twelve} ${suffix}`;
  };
  return `${format(hour)}-${format(hour + 1)}`;
}

function isMeaningful(log: Log) {
  return Boolean(log.activity.trim() || log.loggedAt || log.category !== "admin" || Number.isFinite(log.score) && log.score !== 64);
}

function isLogged(log: Log) {
  return isMeaningful(log) || Boolean(log.updatedAt);
}

function isWaste(log: Log) {
  return isLogged(log) && (categories[log.category].waste || log.score < 40);
}

function isFocus(log: Log) {
  return isLogged(log) && (categories[log.category].focus || log.score >= 75);
}

function clampScore(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 64;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function normalizePriority(item: unknown, fallback: string): PriorityItem {
  const record = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
  return {
    id: typeof record.id === "string" && record.id ? record.id : makeId(),
    text: typeof record.text === "string" ? record.text.slice(0, 240) : fallback,
    done: Boolean(record.done),
  };
}

function normalizeLog(input: unknown): Log {
  const record = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const rawCategory = record.category;
  const category = typeof rawCategory === "string" && rawCategory in categories ? (rawCategory as CategoryKey) : "admin";
  return {
    activity: typeof record.activity === "string" ? record.activity.slice(0, 500) : "",
    category,
    score: clampScore(record.score ?? categories[category].score),
    loggedAt: typeof record.loggedAt === "string" ? record.loggedAt : "",
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : "",
  };
}

function defaultPriorities(values: string[]) {
  return values.map((text) => ({ id: makeId(), text, done: false }));
}

function createDefaultState(): TempoState {
  return {
    auth: { loggedIn: false, email: "", loggedInAt: "" },
    settings: { reminders: false, focusAlerts: true, focusThreshold: DEFAULT_THRESHOLD },
    logs: {},
    priorities: { days: {}, weeks: {} },
    selectedDate: dateKey(),
    lastReminderKey: "",
    lastFocusAlertKey: "",
  };
}

function ensureDayLogs(state: TempoState, selectedDate = state.selectedDate) {
  const logs = { ...state.logs };
  const dayLogs = { ...(logs[selectedDate] || {}) };
  for (let hour = START_HOUR; hour < END_HOUR; hour += 1) {
    dayLogs[String(hour)] = normalizeLog(dayLogs[String(hour)]);
  }
  logs[selectedDate] = dayLogs;
  return { ...state, logs };
}

function previousPriorityList(lists: Record<string, PriorityItem[]>, currentKey: string) {
  const keys = Object.keys(lists).filter((key) => key < currentKey && lists[key]?.length).sort();
  return keys.length ? lists[keys[keys.length - 1]].map((item) => ({ ...item, id: makeId(), done: false })) : null;
}

function ensurePriorities(state: TempoState, selectedDate = state.selectedDate) {
  const week = weekKey(selectedDate);
  const days = { ...state.priorities.days };
  const weeks = { ...state.priorities.weeks };
  if (!days[selectedDate]) {
    days[selectedDate] = previousPriorityList(days, selectedDate) || defaultPriorities(dayDefaults);
  }
  if (!weeks[week]) {
    weeks[week] = previousPriorityList(weeks, week) || defaultPriorities(weekDefaults);
  }
  return { ...state, priorities: { days, weeks } };
}

function sanitizeState(input: unknown): TempoState {
  const fallback = createDefaultState();
  const record = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const auth = record.auth && typeof record.auth === "object" ? (record.auth as Record<string, unknown>) : {};
  const settings = record.settings && typeof record.settings === "object" ? (record.settings as Record<string, unknown>) : {};
  const selectedDate = dateKey();

  const logs: TempoState["logs"] = {};
  const rawLogs = record.logs && typeof record.logs === "object" ? (record.logs as Record<string, unknown>) : {};
  for (const [day, slots] of Object.entries(rawLogs)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !slots || typeof slots !== "object") continue;
    logs[day] = {};
    for (const [hour, value] of Object.entries(slots as Record<string, unknown>)) {
      const h = Number(hour);
      if (Number.isInteger(h) && h >= START_HOUR && h < END_HOUR) logs[day][hour] = normalizeLog(value);
    }
  }

  const normalizeLists = (raw: unknown, defaults: string[]) => {
    const out: Record<string, PriorityItem[]> = {};
    const lists = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    for (const [key, value] of Object.entries(lists)) {
      if (!Array.isArray(value)) continue;
      out[key] = value.slice(0, 20).map((item, index) => normalizePriority(item, defaults[index] || ""));
    }
    return out;
  };

  const rawPriorities = record.priorities && typeof record.priorities === "object" ? (record.priorities as Record<string, unknown>) : {};
  const threshold = Number(settings.focusThreshold);
  const state: TempoState = {
    auth: {
      loggedIn: Boolean(auth.loggedIn),
      email: typeof auth.email === "string" ? auth.email : "",
      loggedInAt: typeof auth.loggedInAt === "string" ? auth.loggedInAt : "",
    },
    settings: {
      reminders: Boolean(settings.reminders),
      focusAlerts: typeof settings.focusAlerts === "boolean" ? settings.focusAlerts : true,
      focusThreshold: Number.isFinite(threshold) ? Math.max(1, Math.min(SLOT_COUNT, Math.round(threshold))) : DEFAULT_THRESHOLD,
    },
    logs,
    priorities: {
      days: normalizeLists(rawPriorities.days, dayDefaults),
      weeks: normalizeLists(rawPriorities.weeks, weekDefaults),
    },
    selectedDate,
    lastReminderKey: typeof record.lastReminderKey === "string" ? record.lastReminderKey : fallback.lastReminderKey,
    lastFocusAlertKey: typeof record.lastFocusAlertKey === "string" ? record.lastFocusAlertKey : fallback.lastFocusAlertKey,
  };
  return ensurePriorities(ensureDayLogs(state), selectedDate);
}

function calcDayStats(dayLogs: Record<string, Log> = {}): DayStats {
  let logged = 0;
  let focusHours = 0;
  let wasteHours = 0;
  let scoreSum = 0;
  let streak = 0;
  let bestStreak = 0;

  for (let hour = START_HOUR; hour < END_HOUR; hour += 1) {
    const log = normalizeLog(dayLogs[String(hour)]);
    if (isLogged(log)) {
      logged += 1;
      scoreSum += log.score;
      if (isFocus(log)) {
        focusHours += 1;
        streak += 1;
        bestStreak = Math.max(bestStreak, streak);
      } else {
        streak = 0;
      }
      if (isWaste(log)) wasteHours += 1;
    } else {
      streak = 0;
    }
  }

  const averageScore = logged ? Math.round(scoreSum / logged) : 0;
  const coverage = logged / SLOT_COUNT;
  const utilization = Math.round(Math.min(100, averageScore * 0.7 + coverage * 30));
  return { logged, focusHours, wasteHours, bestStreak, utilization, averageScore };
}

function moodForStats(stats: DayStats) {
  if (!stats.logged) return { face: "o", label: "Ready", detail: "Start by naming the current block.", color: "#64748b" };
  if (stats.wasteHours <= 1 && stats.utilization >= 75) {
    return { face: "^", label: "Locked in", detail: "Strong focus density today.", color: "#059669" };
  }
  if (stats.wasteHours >= 3 || stats.utilization < 45) {
    return { face: "!", label: "Reset", detail: "One clean next block can change the day.", color: "#dc2626" };
  }
  return { face: "-", label: "Steady", detail: "Keep shaping the day one hour at a time.", color: "#d97706" };
}

function analyzePeriod(state: TempoState, tab: AnalysisTab) {
  const selected = parseDateKey(state.selectedDate);
  const entries = Object.entries(state.logs).filter(([key]) => {
    const d = parseDateKey(key);
    if (tab === "daily") return key === state.selectedDate;
    if (tab === "weekly") return weekKey(key) === weekKey(state.selectedDate);
    return d.getFullYear() === selected.getFullYear() && d.getMonth() === selected.getMonth();
  });

  const totals = entries.reduce(
    (acc, [, logs]) => {
      const stats = calcDayStats(logs);
      acc.logged += stats.logged;
      acc.focus += stats.focusHours;
      acc.waste += stats.wasteHours;
      acc.utilization += stats.utilization;
      acc.days += 1;
      return acc;
    },
    { logged: 0, focus: 0, waste: 0, utilization: 0, days: 0 },
  );

  const utilization = totals.days ? Math.round(totals.utilization / totals.days) : 0;
  const summary = tab === "daily"
    ? `${totals.logged} of ${SLOT_COUNT} blocks logged for ${longDate(state.selectedDate)}.`
    : `${totals.days} day${totals.days === 1 ? "" : "s"} with ${totals.logged} logged blocks, ${totals.focus} focus, ${totals.waste} reset.`;

  const insights = entries.flatMap(([key, logs]) =>
    Object.entries(logs)
      .filter(([, log]) => isLogged(log))
      .map(([hour, log]) => ({
        key: `${key}-${hour}`,
        label: tab === "daily" ? hourLabel(Number(hour)) : `${key} ${hourLabel(Number(hour))}`,
        text: `${categories[log.category].label}: ${log.activity || "No activity note"} (${log.score})`,
        score: log.score,
      })),
  ).slice(0, 24);

  return { summary, totals, utilization, insights };
}

function localAdvice(stats: DayStats, dayPriorities: PriorityItem[], logs: Log[], threshold: number): Advice {
  const low = logs.find((log) => isLogged(log) && log.score < 45);
  const best = logs.find((log) => isLogged(log) && log.score >= 75);
  const priority = dayPriorities.find((item) => item.text.trim() && !item.done)?.text || dayPriorities[0]?.text;
  const suggestions = [
    stats.logged ? "Keep the log lightweight: name the block, pick the closest category, and move on." : "Start with the current hour and one honest note.",
    low ? `Protect against another low-score block by removing the trigger behind "${low.activity || categories[low.category].label}".` : "Use your next available hour for a single defined outcome.",
    best ? `Repeat the conditions that made "${best.activity || categories[best.category].label}" work.` : "Choose one block today that deserves deep work conditions.",
  ];
  if (stats.wasteHours >= threshold) suggestions.push("The reset signal is active; make the next block smaller, cleaner, and phone-light.");
  return {
    summary: stats.logged
      ? `You logged ${stats.logged} blocks with ${stats.focusHours} focus and ${stats.wasteHours} reset blocks.`
      : "No blocks are logged yet, so the best move is to create the first signal.",
    suggestions: suggestions.slice(0, 4),
    nextBlock: priority ? `Next block: advance "${priority}" with one concrete action.` : "Next block: pick one useful task and finish the smallest visible piece.",
  };
}

export default function Home() {
  const [state, setState] = useState<TempoState>(() => createDefaultState());
  const [ready, setReady] = useState(false);
  const [loginEmail, setLoginEmail] = useState("");
  const [authMessage, setAuthMessage] = useState("Your email ID is checked by the local TempoFocus server.");
  const [analysisTab, setAnalysisTab] = useState<AnalysisTab>("daily");
  const [advice, setAdvice] = useState<Advice | null>(null);
  const [coachStatus, setCoachStatus] = useState("");
  const [notificationMessage, setNotificationMessage] = useState("");
  const [dailyQuote, setDailyQuote] = useState<{ quote: string; author: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const hourRefs = useRef<Record<string, HTMLElement | null>>({});
  const lastNotifiedRef = useRef<string>("");

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        setState(sanitizeState(raw ? JSON.parse(raw) : createDefaultState()));
      } catch {
        setState(sanitizeState(createDefaultState()));
      }
      setReady(true);
    }, 0);
    if ("serviceWorker" in navigator && window.location.protocol !== "file:") {
      navigator.serviceWorker.register(`/service-worker.js?v=${APP_VERSION}`).catch(() => undefined);
    }
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (ready) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [ready, state]);

  useEffect(() => {
    const today = dateKey();
    try {
      const stored = JSON.parse(window.localStorage.getItem(QUOTE_KEY) || "null");
      if (stored?.date === today && stored?.quote) { setDailyQuote(stored); return; }
    } catch {}
    fetch(`/api/quote?date=${today}`)
      .then((r) => r.json())
      .then((data) => {
        if (data?.quote) {
          const q = { date: today, quote: data.quote, author: data.author || "" };
          window.localStorage.setItem(QUOTE_KEY, JSON.stringify(q));
          setDailyQuote(q);
        }
      })
      .catch(() => undefined);
  }, []);

  // Sync the last-notified ref with persisted state once localStorage is loaded
  useEffect(() => {
    if (ready) lastNotifiedRef.current = state.lastReminderKey;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  // Hourly notification: checks every 30s, fires once per hour in the first 2 minutes
  useEffect(() => {
    if (!state.auth.loggedIn || !state.settings.reminders) return;
    if (!("Notification" in window)) return;
    if (Notification.permission === "default") Notification.requestPermission();

    const check = () => {
      if (Notification.permission !== "granted") return;
      const now = new Date();
      if (now.getMinutes() > 2) return;
      const h = now.getHours();
      if (h < START_HOUR || h >= END_HOUR) return;
      const key = `${dateKey()}-${h}`;
      if (lastNotifiedRef.current === key) return;
      lastNotifiedRef.current = key;
      mutate((s) => ({ ...s, lastReminderKey: key }));
      new Notification("TempoFocus — log this hour", {
        body: `${String(h).padStart(2, "0")}:00 — what did you do in the last block?`,
        icon: "/icon-192.png",
      });
    };

    check();
    const interval = window.setInterval(check, 30_000);
    return () => window.clearInterval(interval);
  }, [state.auth.loggedIn, state.settings.reminders]);

  const selectedLogs = useMemo(() => state.logs[state.selectedDate] || {}, [state.logs, state.selectedDate]);
  const selectedWeek = weekKey(state.selectedDate);
  const dayPriorities = state.priorities.days[state.selectedDate] || [];
  const weekPriorities = state.priorities.weeks[selectedWeek] || [];
  const stats = useMemo(() => calcDayStats(selectedLogs), [selectedLogs]);
  const mood = moodForStats(stats);
  const analysis = useMemo(() => analyzePeriod(state, analysisTab), [state, analysisTab]);
  const today = dateKey();
  const selectedIsToday = state.selectedDate === today;
  const nowHour = new Date().getHours();
  const alertKey = `${state.selectedDate}:${state.settings.focusThreshold}:${stats.wasteHours}`;
  const showFocusAlert = state.settings.focusAlerts && stats.wasteHours >= state.settings.focusThreshold && state.lastFocusAlertKey !== alertKey;

  const mutate = (updater: (current: TempoState) => TempoState) => {
    setState((current) => ensurePriorities(ensureDayLogs(updater(current))));
  };

  const updateLog = (hour: number, patch: Partial<Log>, meaningful = true) => {
    mutate((current) => {
      const day = current.selectedDate;
      const logs = { ...current.logs };
      const dayLogs = { ...(logs[day] || {}) };
      const previous = normalizeLog(dayLogs[String(hour)]);
      const now = new Date().toISOString();
      const next = { ...previous, ...patch, updatedAt: now };
      if (meaningful && !next.loggedAt) next.loggedAt = now;
      dayLogs[String(hour)] = next;
      logs[day] = dayLogs;
      return { ...current, logs };
    });
  };

  const submitLogin = async (event: FormEvent) => {
    event.preventDefault();
    const email = loginEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setAuthMessage("Enter a valid email ID.");
      return;
    }
    try {
      if (window.location.protocol === "file:") {
        mutate((current) => ({ ...current, auth: { loggedIn: true, email, loggedInAt: new Date().toISOString() } }));
        return;
      }
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Login failed.");
      mutate((current) => ({ ...current, auth: { loggedIn: true, email: data.email, loggedInAt: new Date().toISOString() } }));
      setAuthMessage("Welcome to TempoFocus.");
    } catch (error) {
      setAuthMessage(error instanceof Error ? error.message : "Login failed.");
    }
  };

  const changeDate = (value: string) => {
    mutate((current) => ({ ...current, selectedDate: value }));
    setAdvice(null);
  };

  const jumpToCurrent = () => {
    changeDate(today);
    window.setTimeout(() => hourRefs.current[String(nowHour)]?.scrollIntoView({ behavior: "smooth", block: "center" }), 60);
  };

  const updatePriority = (scope: "days" | "weeks", index: number, patch: Partial<PriorityItem>) => {
    mutate((current) => {
      const key = scope === "days" ? current.selectedDate : weekKey(current.selectedDate);
      const priorities = { days: { ...current.priorities.days }, weeks: { ...current.priorities.weeks } };
      const list = [...(priorities[scope][key] || [])];
      list[index] = { ...list[index], ...patch };
      priorities[scope][key] = list;
      return { ...current, priorities };
    });
  };

  const addPriority = (scope: "days" | "weeks") => {
    mutate((current) => {
      const key = scope === "days" ? current.selectedDate : weekKey(current.selectedDate);
      const priorities = { days: { ...current.priorities.days }, weeks: { ...current.priorities.weeks } };
      priorities[scope][key] = [...(priorities[scope][key] || []), { id: makeId(), text: "", done: false }];
      return { ...current, priorities };
    });
  };

  const removePriority = (scope: "days" | "weeks", index: number) => {
    mutate((current) => {
      const key = scope === "days" ? current.selectedDate : weekKey(current.selectedDate);
      const priorities = { days: { ...current.priorities.days }, weeks: { ...current.priorities.weeks } };
      priorities[scope][key] = (priorities[scope][key] || []).filter((_, itemIndex) => itemIndex !== index);
      return { ...current, priorities };
    });
  };

  const resetPriority = (scope: "days" | "weeks") => {
    mutate((current) => {
      const key = scope === "days" ? current.selectedDate : weekKey(current.selectedDate);
      const priorities = { days: { ...current.priorities.days }, weeks: { ...current.priorities.weeks } };
      priorities[scope][key] = defaultPriorities(scope === "days" ? dayDefaults : weekDefaults);
      return { ...current, priorities };
    });
  };

  const exportData = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `tempo-focus-${today}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const importData = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const imported = sanitizeState(JSON.parse(await file.text()));
      setState(imported);
      setNotificationMessage("Import complete.");
    } catch {
      setNotificationMessage("Import failed.");
    } finally {
      event.target.value = "";
    }
  };

  const testReminder = async () => {
    if (!("Notification" in window)) {
      setNotificationMessage("Notifications are not supported here.");
      return;
    }
    const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
    if (permission === "granted") {
      new Notification("TempoFocus ping", { body: "Your reminder channel is ready." });
      setNotificationMessage("TempoFocus ping sent.");
    } else {
      setNotificationMessage("Notification permission was not granted.");
    }
  };

  const requestCoach = async () => {
    const logs = Object.values(selectedLogs).map(normalizeLog).filter(isLogged).slice(0, 24);
    setCoachStatus("Thinking...");
    try {
      const res = await fetch("/api/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: state.selectedDate,
          stats,
          dayPriorities,
          weekPriorities,
          logs,
          threshold: state.settings.focusThreshold,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Coach unavailable.");
      setAdvice(data.advice);
      setCoachStatus(data.fallback ? `Local fallback: ${data.fallback}` : "Coach ready.");
    } catch {
      setAdvice(localAdvice(stats, dayPriorities, logs, state.settings.focusThreshold));
      setCoachStatus("Local coach ready.");
    }
  };

  const renderPriorityList = (scope: "days" | "weeks", items: PriorityItem[]) => (
    <div className={styles.priorityBlock}>
      <div className={styles.blockHeader}>
        <div>
          <span>{scope === "days" ? "Day priorities" : "Week priorities"}</span>
          <small>{scope === "days" ? longDate(state.selectedDate) : selectedWeek}</small>
        </div>
        <div className={styles.inlineActions}>
          <button type="button" onClick={() => addPriority(scope)}>Add</button>
          <button type="button" onClick={() => resetPriority(scope)}>Reset</button>
        </div>
      </div>
      <div className={styles.priorityList}>
        {items.length === 0 && <p className={styles.empty}>{scope === "days" ? "Add today's priorities." : "Add this week's priorities."}</p>}
        {items.map((item, index) => (
          <label className={styles.priorityItem} key={item.id}>
            <input
              aria-label={`Mark ${item.text || "priority"} done`}
              checked={item.done}
              type="checkbox"
              onChange={(event) => updatePriority(scope, index, { done: event.target.checked })}
            />
            <input
              aria-label={`${scope === "days" ? "Day" : "Week"} priority text`}
              value={item.text}
              onChange={(event) => updatePriority(scope, index, { text: event.target.value.slice(0, 240) })}
            />
            <button type="button" aria-label="Remove priority" onClick={() => removePriority(scope, index)}>x</button>
          </label>
        ))}
      </div>
    </div>
  );

  if (!ready) return <main className={styles.loading}>Loading TempoFocus...</main>;

  if (!state.auth.loggedIn) {
    return (
      <main className={styles.authScreen}>
        <form className={styles.authCard} onSubmit={submitLogin}>
          <p className={styles.eyebrow}>TempoFocus</p>
          <h1>Log the day by the hour.</h1>
          <p>Local-first tracking for focus, resets, and priorities.</p>
          <input
            aria-label="Email ID"
            autoFocus
            inputMode="email"
            placeholder="you@example.com"
            type="email"
            value={loginEmail}
            onChange={(event) => setLoginEmail(event.target.value)}
          />
          <button type="submit">Continue</button>
          <span aria-live="polite">{authMessage}</span>
        </form>
      </main>
    );
  }

  return (
    <main className={styles.superShell}>
      <nav className={styles.superNav} aria-label="TempoFocus navigation">
        <div className={styles.superBrand}>
          <span>TF</span>
          <strong>TempoFocus</strong>
        </div>
        <div className={styles.superLinks}>
          <button type="button" onClick={jumpToCurrent}>Today</button>
          <button type="button" onClick={requestCoach}>Coach</button>
          <button type="button" onClick={exportData}>Export</button>
          <button type="button" onClick={() => fileInputRef.current?.click()}>Import</button>
          <input ref={fileInputRef} className={styles.hidden} type="file" accept="application/json" onChange={importData} />
        </div>
        <div className={styles.superActions}>
          <span>{state.auth.email}</span>
          <button type="button" onClick={() => {
            mutate((current) => ({ ...current, auth: { loggedIn: false, email: "", loggedInAt: "" } }));
            setLoginEmail("");
          }}>Log out</button>
        </div>
      </nav>

      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <p className={styles.heroKicker}>Track your hours. Cut the distractions</p>
          <h1>{dailyQuote ? `"${dailyQuote.quote}"` : "Everything you want to focus on, done."}</h1>
          {dailyQuote?.author && <p className={styles.quoteAuthor}>— {dailyQuote.author}</p>}
          <div className={styles.heroControls}>
            <input aria-label="Selected date" type="date" value={state.selectedDate} onChange={(event) => changeDate(event.target.value)} />
            <button type="button" onClick={jumpToCurrent}>Jump to current</button>
            <button type="button" onClick={testReminder}>Test reminder</button>
          </div>
          {notificationMessage && <p className={styles.reminderStatus} aria-live="polite">{notificationMessage}</p>}
        </div>
        <div className={styles.heroStats}>
          <span>{stats.logged}/{SLOT_COUNT}<small>Logged</small></span>
          <span>{stats.focusHours}<small>Focus</small></span>
          <span>{stats.wasteHours}<small>Reset</small></span>
          <span>{stats.utilization}%<small>Flow</small></span>
        </div>
        <section className={styles.priorityShelf}>
          {renderPriorityList("days", dayPriorities)}
          {renderPriorityList("weeks", weekPriorities)}
        </section>
      </section>

      {showFocusAlert && (
        <section className={styles.focusAlert} role="alert">
          <strong>{stats.wasteHours} reset hours logged.</strong>
          <span>Reset the next block with a small, clear win.</span>
          <button type="button" onClick={() => mutate((current) => ({ ...current, lastFocusAlertKey: alertKey }))}>Dismiss</button>
        </section>
      )}

      <section className={styles.productStage}>
        <aside className={styles.aiCard}>
          <div className={styles.aiBubble}>
            <strong>{mood.label}</strong>
            <p>{mood.detail}</p>
          </div>
          <div className={styles.aiPrompt}>
            <span>Would you like me to plan your next focus block?</span>
            <button type="button" onClick={requestCoach}>AI Coach</button>
          </div>
          <div className={styles.coachOutput}>
            {advice ? (
              <>
                <p>{advice.summary}</p>
                {advice.suggestions.length > 0 && (
                  <ul className={styles.coachSuggestions}>
                    {advice.suggestions.map((s, i) => <li key={i}>{s}</li>)}
                  </ul>
                )}
                <strong>{advice.nextBlock}</strong>
              </>
            ) : (
              <p>{coachStatus || "Coach advice appears here after Suggest."}</p>
            )}
          </div>
        </aside>

        <section className={styles.mailCard}>

          <div className={styles.messageList}>
            {Array.from({ length: SLOT_COUNT }, (_, index) => START_HOUR + index).map((hour) => {
              const log = normalizeLog(selectedLogs[String(hour)]);
              const now = selectedIsToday && hour === nowHour;
              const pastBlank = selectedIsToday && hour < nowHour && !isLogged(log);
              const stateLabel = now ? "now" : isLogged(log) && isWaste(log) ? "reset" : isLogged(log) ? "logged" : pastBlank ? "blank" : "open";
              return (
                <article
                  ref={(node) => { hourRefs.current[String(hour)] = node; }}
                  className={`${styles.messageRow} ${now ? styles.now : ""} ${isLogged(log) ? styles.logged : styles.unlogged} ${isFocus(log) ? styles.focus : ""} ${isWaste(log) ? styles.waste : ""}`}
                  key={hour}
                  style={{ "--cat": categories[log.category].color } as CSSProperties}
                >
                  <span className={styles.messageDot} />
                  <div>
                    <strong>{hourLabel(hour)}</strong>
                    <input
                      aria-label={`Activity for ${hourLabel(hour)}`}
                      placeholder="Write what happened in this block"
                      value={log.activity}
                      onChange={(event) => updateLog(hour, { activity: event.target.value.slice(0, 500) }, Boolean(event.target.value.trim()))}
                      onKeyUp={(event) => updateLog(hour, { activity: event.currentTarget.value.slice(0, 500) }, Boolean(event.currentTarget.value.trim()))}
                      onPaste={(event) => updateLog(hour, { activity: event.currentTarget.value.slice(0, 500) }, true)}
                      onCompositionEnd={(event) => updateLog(hour, { activity: event.currentTarget.value.slice(0, 500) }, true)}
                    />
                    <small>{categories[log.category].label} · {stateLabel}</small>
                  </div>
                  <select
                    aria-label={`Category for ${hourLabel(hour)}`}
                    value={log.category}
                    onChange={(event) => {
                      const category = event.target.value as CategoryKey;
                      updateLog(hour, { category, score: categories[category].score }, true);
                    }}
                  >
                    {Object.entries(categories).map(([key, category]) => <option key={key} value={key}>{category.label}</option>)}
                  </select>
                  <label>
                    <b>{log.score}</b>
                    <input
                      aria-label={`Score for ${hourLabel(hour)}`}
                      max="100"
                      min="0"
                      type="range"
                      value={log.score}
                      onChange={(event) => updateLog(hour, { score: Number(event.target.value) }, Number(event.target.value) !== 64)}
                      onPointerUp={(event) => updateLog(hour, { score: Number((event.target as HTMLInputElement).value) }, true)}
                    />
                  </label>
                </article>
              );
            })}
          </div>
        </section>

        <aside className={styles.docCard}>
          <div className={styles.docHeader}>
            <span>Team workspace</span>
            <button type="button" onClick={() => {
              const next = !state.settings.reminders;
              if (next && "Notification" in window && Notification.permission === "default") Notification.requestPermission();
              mutate((current) => ({ ...current, settings: { ...current.settings, reminders: next } }));
            }}>
              {state.settings.reminders ? "Reminders on" : "Reminders"}
            </button>
          </div>
          <h2>Streamlining your focus day</h2>
          <p>{analysis.summary}</p>
          <div className={styles.tabs} role="tablist" aria-label="Analysis views">
            {(["daily", "weekly", "monthly"] as AnalysisTab[]).map((tab) => (
              <button aria-selected={analysisTab === tab} key={tab} role="tab" type="button" onClick={() => setAnalysisTab(tab)}>
                {tab}
              </button>
            ))}
          </div>
          <div className={styles.barShell}><span style={{ width: `${analysis.utilization}%` }} /></div>
        </aside>
      </section>

    </main>
  );
}
