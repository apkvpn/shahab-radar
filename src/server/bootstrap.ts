import { log } from "./core";
import { startScanner } from "./scanner";

const g = globalThis as typeof globalThis & { __shahabBoot?: Promise<void> };

/** Idempotent: starts the background scanner exactly once per process. */
export function ensureStarted(): Promise<void> {
  if (process.env.NEXT_PHASE === "phase-production-build") return Promise.resolve();
  if (!g.__shahabBoot) {
    g.__shahabBoot = startScanner().catch((e) => {
      g.__shahabBoot = undefined; // allow a later retry
      log("scanner failed to start:", e instanceof Error ? e.message : "error");
      throw e;
    });
  }
  return g.__shahabBoot;
}
