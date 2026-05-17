import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

type Advice = {
  summary: string;
  suggestions: string[];
  nextBlock: string;
};

type CoachPayload = {
  date?: string;
  stats?: {
    logged?: number;
    focusHours?: number;
    wasteHours?: number;
    bestStreak?: number;
    utilization?: number;
  };
  dayPriorities?: Array<{ text?: string; done?: boolean }>;
  weekPriorities?: Array<{ text?: string; done?: boolean }>;
  logs?: Array<{ activity?: string; category?: string; score?: number }>;
  threshold?: number;
};

const cap = (value: unknown, max: number, fallback: string) => {
  const text = typeof value === "string" && value.trim() ? value.trim() : fallback;
  return text.slice(0, max);
};

function normalizeAdvice(input: unknown): Advice {
  const record = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const rawSuggestions = Array.isArray(record.suggestions) ? record.suggestions : [];
  const suggestions = rawSuggestions
    .map((item) => cap(item, 220, "Choose one small useful action for the next block."))
    .filter(Boolean)
    .slice(0, 4);

  while (suggestions.length < 3) {
    suggestions.push("Keep the next block concrete, visible, and easy to start.");
  }

  return {
    summary: cap(record.summary, 220, "Your day has enough signal for a compact reset plan."),
    suggestions,
    nextBlock: cap(record.nextBlock, 260, "Pick the next priority and define one finishable action."),
  };
}

function localAdvice(payload: CoachPayload): Advice {
  const stats = payload.stats || {};
  const logs = Array.isArray(payload.logs) ? payload.logs : [];
  const threshold = Number.isFinite(payload.threshold) ? Number(payload.threshold) : 3;
  const low = logs.find((log) => Number(log.score) < 45);
  const best = logs.find((log) => Number(log.score) >= 75);
  const priority = (payload.dayPriorities || []).find((item) => item.text && !item.done)?.text
    || payload.dayPriorities?.[0]?.text
    || "your highest-leverage priority";

  const suggestions = [
    stats.logged ? "Keep logging each block with the minimum honest note." : "Start with the current hour and write one plain activity note.",
    low ? `Reduce the trigger around "${low.activity || low.category || "the low-score block"}" before it repeats.` : "Give the next block one outcome and one stopping point.",
    best ? `Repeat the setup that made "${best.activity || best.category || "your best block"}" work.` : "Create one protected focus block before the day gets noisier.",
  ];

  if (Number(stats.wasteHours || 0) >= threshold) {
    suggestions.push("Treat the reset alert as a cue to make the next block smaller, not harsher.");
  }

  return normalizeAdvice({
    summary: stats.logged
      ? `You logged ${stats.logged} blocks with ${stats.focusHours || 0} focus and ${stats.wasteHours || 0} reset blocks.`
      : "No blocks are logged yet, so the best signal is the first honest entry.",
    suggestions,
    nextBlock: `Next block: advance "${priority}" with one concrete action.`,
  });
}

const SYSTEM_PROMPT = `You are a practical daily focus coach embedded in a time-tracking app.
The user sends you their daily stats, priority list, and hourly activity log.
Return ONLY valid JSON with exactly these fields:
  "summary": one sentence (max 220 chars) describing today's pattern
  "suggestions": array of 3–4 actionable strings (max 220 chars each) for the next block
  "nextBlock": one sentence (max 260 chars) naming the single most important action right now
Be practical, kind, and never shame the user. Focus on what they can do in the next hour.`;

async function requestOpenAiAdvice(payload: CoachPayload): Promise<Advice> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured.");

  const client = new OpenAI({ apiKey });

  const completion = await client.chat.completions.create({
    model: process.env.OPENAI_MODEL || "gpt-4o",
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: JSON.stringify({
          date: payload.date,
          stats: payload.stats,
          dayPriorities: payload.dayPriorities,
          weekPriorities: payload.weekPriorities,
          logs: (payload.logs || []).slice(0, 24),
          threshold: payload.threshold,
        }),
      },
    ],
  });

  const text = completion.choices[0]?.message?.content || "";
  return normalizeAdvice(JSON.parse(text));
}

export async function POST(request: NextRequest) {
  let payload: CoachPayload;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON." }, { status: 400 });
  }

  if (!payload || typeof payload !== "object" || !payload.date || !payload.stats) {
    return NextResponse.json({ ok: false, error: "Missing coach payload." }, { status: 400 });
  }

  try {
    const advice = await requestOpenAiAdvice(payload);
    return NextResponse.json({ ok: true, advice });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "OpenAI unavailable.";
    return NextResponse.json({ ok: true, advice: localAdvice(payload), fallback: reason });
  }
}
