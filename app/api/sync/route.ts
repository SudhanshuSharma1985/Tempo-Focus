import { NextRequest, NextResponse } from "next/server";

// ----- Redis (Upstash) -----
// Used when UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN are set (Vercel / cloud)
async function redisGet(): Promise<unknown> {
  const { Redis } = await import("@upstash/redis");
  const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
  });
  return redis.get("tempo-state");
}

async function redisSet(value: unknown): Promise<void> {
  const { Redis } = await import("@upstash/redis");
  const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
  });
  await redis.set("tempo-state", value);
}

// ----- Filesystem fallback -----
// Used in local development when Redis env vars are absent
async function fsGet(): Promise<unknown> {
  const { readFile } = await import("fs/promises");
  const { join } = await import("path");
  const raw = await readFile(join(process.cwd(), "data", "state.json"), "utf-8");
  return JSON.parse(raw);
}

async function fsSet(value: unknown): Promise<void> {
  const { writeFile, mkdir } = await import("fs/promises");
  const { join } = await import("path");
  const dir = join(process.cwd(), "data");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "state.json"), JSON.stringify(value), "utf-8");
}

const useRedis = () =>
  Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);

export async function GET() {
  try {
    const state = useRedis() ? await redisGet() : await fsGet();
    return NextResponse.json({ ok: true, state: state ?? null });
  } catch {
    return NextResponse.json({ ok: true, state: null });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    if (!body || typeof body !== "object") {
      return NextResponse.json({ ok: false, error: "Invalid payload." }, { status: 400 });
    }
    useRedis() ? await redisSet(body) : await fsSet(body);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ ok: false, error: String(error) }, { status: 500 });
  }
}
