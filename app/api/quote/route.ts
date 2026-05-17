import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

const FALLBACKS = [
  { quote: "The secret of getting ahead is getting started.", author: "Mark Twain" },
  { quote: "It always seems impossible until it's done.", author: "Nelson Mandela" },
  { quote: "Focus on being productive instead of busy.", author: "Tim Ferriss" },
  { quote: "Do the hard jobs first. The easy jobs will take care of themselves.", author: "Dale Carnegie" },
  { quote: "You don't have to be great to start, but you have to start to be great.", author: "Zig Ziglar" },
];

export async function GET(request: NextRequest) {
  const date = request.nextUrl.searchParams.get("date") || new Date().toISOString().slice(0, 10);

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    const fb = FALLBACKS[Math.abs(date.split("").reduce((a, c) => a + c.charCodeAt(0), 0)) % FALLBACKS.length];
    return NextResponse.json(fb);
  }

  const client = new OpenAI({ apiKey });

  try {
    const completion = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4o",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: "Return a famous motivational quote as JSON with \"quote\" and \"author\" fields. The quote must be genuinely famous, under 80 characters, and inspiring for a focused workday. Use the date as a seed to vary which quote you return. Return ONLY valid JSON, no other text.",
        },
        {
          role: "user",
          content: `Date: ${date}`,
        },
      ],
    });

    const text = completion.choices[0]?.message?.content || "{}";
    const data = JSON.parse(text);
    const quote = typeof data.quote === "string" ? data.quote.trim().slice(0, 160) : null;
    const author = typeof data.author === "string" ? data.author.trim().slice(0, 80) : "Unknown";

    if (!quote) throw new Error("Empty quote");
    return NextResponse.json({ quote, author });
  } catch {
    const fb = FALLBACKS[Math.abs(date.split("").reduce((a, c) => a + c.charCodeAt(0), 0)) % FALLBACKS.length];
    return NextResponse.json(fb);
  }
}
