import { NextRequest, NextResponse } from "next/server";

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

async function requestOpenAiAdvice(payload: CoachPayload): Promise<Advice> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured.");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-5.2",
        input: [
          {
            role: "system",
            content: "Return compact JSON only with summary, suggestions array, and nextBlock. Be practical and never shame the user.",
          },
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
      }),
    });

    if (!response.ok) throw new Error(`OpenAI returned ${response.status}.`);
    const data = await response.json();
    const text = typeof data.output_text === "string"
      ? data.output_text
      : Array.isArray(data.output)
        ? data.output.flatMap((item: { content?: Array<{ text?: string }> }) => item.content || []).map((item: { text?: string }) => item.text || "").join("")
        : "";
    return normalizeAdvice(JSON.parse(text));
  } finally {
    clearTimeout(timeout);
  }
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
