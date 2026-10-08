import type { PublicSignal } from "@/lib/shared";
import { boot } from "@/server/api";
import { subscribe } from "@/server/core";
import { latestSignals, toPublic } from "@/server/repo";
import { buildSnapshot } from "@/server/views";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Server-Sent Events: realtime LONG signals + a snapshot after every 5s scan. */
export async function GET(req: Request) {
  await boot();
  const encoder = new TextEncoder();
  let cleanup = () => {};

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const write = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup();
        }
      };
      const send = (event: string, data: unknown) => write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

      const unsub = subscribe((evt) => send(evt.type, evt.data));
      const hb = setInterval(() => write(": ping\n\n"), 15_000);
      cleanup = () => {
        if (closed) return;
        closed = true;
        unsub();
        clearInterval(hb);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      req.signal.addEventListener("abort", cleanup);

      write("retry: 3000\n\n");
      let latest: PublicSignal[] = [];
      try {
        latest = (await latestSignals(15)).map(toPublic);
      } catch {
        /* database hiccup: the snapshot is still useful */
      }
      send("hello", { snapshot: buildSnapshot(), signals: latest });
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
