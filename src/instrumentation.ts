export async function register() {
  // The scanner runs inside the production server process, independent of any open browser.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { ensureStarted } = await import("./server/bootstrap");
    ensureStarted().catch(() => {
      /* logged inside; API routes will retry on demand */
    });
  }
}
