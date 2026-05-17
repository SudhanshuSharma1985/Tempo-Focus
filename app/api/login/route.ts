import { NextRequest, NextResponse } from "next/server";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: NextRequest) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON." }, { status: 400 });
  }

  const email = typeof (payload as { email?: unknown }).email === "string"
    ? (payload as { email: string }).email.trim().toLowerCase()
    : "";

  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ ok: false, error: "Enter a valid email ID." }, { status: 400 });
  }

  const allowed = process.env.APP_LOGIN_EMAIL?.trim().toLowerCase();
  if (allowed && email !== allowed) {
    return NextResponse.json({ ok: false, error: "This email ID is not allowed." }, { status: 401 });
  }

  return NextResponse.json({ ok: true, email });
}
