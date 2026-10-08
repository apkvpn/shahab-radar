import { NextResponse } from "next/server";
import { ensureStarted } from "./bootstrap";

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

/** Ensures the scanner is running; returns an error response if it cannot start. */
export async function boot(): Promise<NextResponse | null> {
  try {
    await ensureStarted();
    return null;
  } catch {
    return json({ error: "service_starting" }, 503);
  }
}

export const SYMBOL_RE = /^[A-Z0-9]{1,20}$/;

export function num(v: string | null, def: number, min: number, max: number): number {
  const n = Number(v);
  if (!v || !Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, Math.floor(n)));
}
