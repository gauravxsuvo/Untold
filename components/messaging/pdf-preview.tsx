"use client";
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { PDFDocumentProxy } from "pdfjs-dist";
export function PdfPreview({ url, name }: { url: string; name: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const workerRef = useRef<import("pdfjs-dist").PDFWorker | null>(null);
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [text, setText] = useState("");
  useEffect(() => {
    let stopped = false;
    let task: import("pdfjs-dist").PDFDocumentLoadingTask | undefined;
    let worker: import("pdfjs-dist").PDFWorker | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    void (async () => {
      const pdf = await import("pdfjs-dist");
      if (stopped) return;
      pdf.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/build/pdf.worker.min.mjs",
        import.meta.url,
      ).toString();
      worker = new pdf.PDFWorker();
      workerRef.current = worker;
      task = pdf.getDocument({
        url,
        worker,
        useWasm: false,
        useSystemFonts: true,
        maxImageSize: 16_000_000,
        canvasMaxAreaInBytes: 16_000_000,
        stopAtErrors: true,
        disableAutoFetch: true,
        disableStream: true,
        disableRange: true,
      });
      timer = setTimeout(() => {
        if (!stopped) {
          setError("This PDF is taking too long to open. You can download it instead.");
          setBusy(false);
          worker?.destroy();
          void task?.destroy().catch(() => {});
        }
      }, 20_000);
      const next = await task.promise;
      if (next.numPages > 2000) throw new Error("Document too large");
      if (!stopped) {
        setDocument(next);
        setPage(1);
      }
    })()
      .catch(() => {
        worker?.destroy();
        if (!stopped) {
          setError(
            "We couldn’t preview this PDF. It may need a password or another PDF reader. You can download it instead.",
          );
          setBusy(false);
        }
      })
      .finally(() => clearTimeout(timer));
    return () => {
      stopped = true;
      clearTimeout(timer);
      setDocument(null);
      worker?.destroy();
      if (workerRef.current === worker) workerRef.current = null;
      void task?.destroy().catch(() => {});
    };
  }, [url]);
  useEffect(() => {
    if (!document) return;
    let stopped = false;
    let render: import("pdfjs-dist").RenderTask | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setBusy(true);
    setText("");
    setError("");
    timer = setTimeout(() => {
      if (stopped) return;
      render?.cancel();
      workerRef.current?.destroy();
      setError("This PDF is taking too long to display. You can download it instead.");
      setBusy(false);
    }, 20_000);
    void (async () => {
      const pdfPage = await document.getPage(page);
      if (stopped || !canvas.current) return;
      const base = pdfPage.getViewport({ scale: 1 });
      if (
        !Number.isFinite(base.width) ||
        !Number.isFinite(base.height) ||
        base.width <= 0 ||
        base.height <= 0
      )
        throw new Error();
      const scale = Math.min(
        2,
        1600 / base.width,
        Math.sqrt(4_000_000 / (base.width * base.height)),
      );
      const viewport = pdfPage.getViewport({ scale });
      const target = canvas.current;
      target.width = Math.max(1, Math.ceil(viewport.width));
      target.height = Math.max(1, Math.ceil(viewport.height));
      render = pdfPage.render({ canvas: target, viewport });
      await render.promise;
      if (!stopped) setBusy(false);
      const content = await pdfPage.getTextContent();
      if (!stopped)
        setText(
          content.items
            .slice(0, 5000)
            .map((item) => ("str" in item ? item.str : ""))
            .join(" ")
            .slice(0, 50_000),
        );
      pdfPage.cleanup();
    })()
      .catch(() => {
        if (!stopped) {
          setError("This page couldn’t be displayed. Try another page or download the PDF.");
          setBusy(false);
        }
      })
      .finally(() => clearTimeout(timer));
    return () => {
      stopped = true;
      clearTimeout(timer);
      render?.cancel();
    };
  }, [document, page]);
  return (
    <div className="pdf-preview">
      {document ? (
        <div className="pdf-preview__pages">
          <button
            className="feature-button"
            aria-label="Previous page"
            type="button"
            disabled={page === 1 || busy}
            onClick={() => setPage((p) => p - 1)}
          >
            <ChevronLeft size={18} />
          </button>
          <span>
            Page {page} of {document.numPages}
          </span>
          <button
            className="feature-button"
            aria-label="Next page"
            type="button"
            disabled={page === document.numPages || busy}
            onClick={() => setPage((p) => p + 1)}
          >
            <ChevronRight size={18} />
          </button>
        </div>
      ) : null}
      {busy ? <p role="status">Opening PDF…</p> : null}
      {error ? (
        <p role="alert" className="messaging-error">
          {error}
        </p>
      ) : null}
      <canvas
        ref={canvas}
        aria-label={`${name}, page ${page}`}
        role="img"
        className="pdf-preview__canvas"
        hidden={Boolean(error)}
      />
      {text ? (
        <details className="pdf-preview__text">
          <summary>Read page text</summary>
          <p>{text}</p>
        </details>
      ) : null}
    </div>
  );
}
