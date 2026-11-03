"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Draws every page of a PDF onto canvases with pdf.js. A browser's own PDF viewer can't be relied on
 * inside a frame (some draw nothing there), and this looks the same in every browser.
 */
export function PdfPages({ data, label }: { data: ArrayBuffer; label: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    let cancelled = false;
    let destroy: (() => Promise<void>) | undefined;
    void (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc ||= new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
        // pdf.js takes ownership of the bytes it is given, so it gets a copy.
        const task = pdfjs.getDocument({ data: new Uint8Array(data.slice(0)) });
        destroy = () => task.destroy();
        const doc = await task.promise;
        const canvases: HTMLCanvasElement[] = [];
        const ratio = window.devicePixelRatio || 1;
        for (let n = 1; n <= doc.numPages; n++) {
          const page = await doc.getPage(n);
          const scale = (el.clientWidth / page.getViewport({ scale: 1 }).width) * ratio;
          const viewport = page.getViewport({ scale });
          const canvas = document.createElement("canvas");
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.setAttribute("aria-hidden", "true");
          await page.render({ canvas, viewport }).promise;
          canvases.push(canvas);
        }
        if (cancelled) return;
        el.replaceChildren(...canvases);
        setError(null);
      } catch {
        if (!cancelled) setError("Couldn't show the PDF.");
      }
    })();
    return () => {
      cancelled = true;
      void destroy?.();
    };
  }, [data]);

  return (
    <>
      <div ref={box} className="pdf-pages" role="img" aria-label={label} />
      {error && <p className="error">{error}</p>}
    </>
  );
}
