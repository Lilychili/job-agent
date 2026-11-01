import { appEvents } from "@/lib/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Server-Sent Events: forwards Postgres NOTIFY app_events to the browser. */
export async function GET(req: Request) {
  const events = appEvents();
  const encoder = new TextEncoder();
  let cleanup = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup();
        }
      };
      const onEvent = (payload: string) => send(`data: ${payload}\n\n`);
      // Comment line every 20s keeps proxies and the browser from closing an idle stream.
      const keepAlive = setInterval(() => send(": keep-alive\n\n"), 20_000);

      cleanup = () => {
        clearInterval(keepAlive);
        events.off("event", onEvent);
        try {
          controller.close();
        } catch {
          // already closed
        }
      };
      events.on("event", onEvent);
      req.signal.addEventListener("abort", cleanup);
      send("retry: 2000\n\n");
      send(`data: ${JSON.stringify({ type: "hello" })}\n\n`);
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
