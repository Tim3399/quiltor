import { useEffect, useMemo, useRef, useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BookContent } from "./BookContent";
import { loadBookFont } from "./bookFonts";
import { resolveBookLayout } from "./bookLayout";
import { annotateBookPages, type BookPage, bookStyles } from "./bookPagination";
import type { Manuscript } from "./model";
import "./BookDocument.css";
import "./PrintDocument.css";

export type { BookPage } from "./bookPagination";

// Paged.js owns document-level styles. Serialize jobs, including StrictMode remounts,
// and dispose stale jobs before they can publish a result or modify another layout.
let paginationQueue = Promise.resolve();

export function BookDocument({
  manuscript,
  worldTitle,
  onReady,
  onUpdating,
  onError,
}: {
  manuscript: Manuscript;
  worldTitle?: string;
  onReady?: (pages: BookPage[]) => void;
  onUpdating?: () => void;
  onError?: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onReady, onUpdating, onError });
  callbacks.current = { onReady, onUpdating, onError };
  const [status, setStatus] = useState<"updating" | "ready" | "error">("updating");
  const settings = useMemo(() => resolveBookLayout(manuscript.bookLayout), [manuscript.bookLayout]);
  const date = useMemo(() => new Date().toLocaleDateString("de-DE"), []);
  const source = useMemo(
    () =>
      renderToStaticMarkup(
        <BookContent
          manuscript={manuscript}
          settings={settings}
          worldTitle={worldTitle}
          date={date}
        />,
      ),
    [manuscript, settings, worldTitle, date],
  );

  useEffect(() => {
    let cancelled = false;
    let dispose: (() => void) | undefined;
    setStatus("updating");
    callbacks.current.onUpdating?.();
    // Debounce settings changes; zoom and scrolling never enter this effect.
    const timer = setTimeout(() => {
      paginationQueue = paginationQueue
        .catch(() => {})
        .then(async () => {
          if (cancelled || !host.current) return;
          let stage: HTMLDivElement | undefined;
          let previewer: import("pagedjs").Previewer | undefined;
          let printStyle: HTMLStyleElement | undefined;
          const cleanup = () => {
            if (previewer) {
              try {
                previewer.chunker.destroy();
              } catch {
                /* Partial pagination has no page template. */
              }
              try {
                previewer.polisher.destroy();
              } catch {
                /* A failed stylesheet may not be initialized. */
              }
            }
            printStyle?.remove();
            stage?.remove();
          };
          try {
            const [{ Previewer }] = await Promise.all([
              import("pagedjs"),
              loadBookFont(settings.fontFamily),
            ]);
            if (cancelled) return;
            stage = document.createElement("div");
            stage.className = "book-pagination-stage";
            stage.setAttribute("aria-hidden", "true");
            stage.style.width = `${settings.pageWidthMm}mm`;
            document.body.append(stage);
            previewer = new Previewer();
            await previewer.preview(source, [{ [document.baseURI]: bookStyles(settings) }], stage);
            if (cancelled || !host.current) {
              cleanup();
              return;
            }
            const pages = annotateBookPages(stage, settings);
            if (!pages.length) throw new Error("Book pagination produced no pages");
            // The PDF printer receives paginated sheets, with no second set of margins.
            printStyle = document.createElement("style");
            printStyle.media = "print";
            printStyle.textContent = `@page { size: ${settings.pageWidthMm}mm ${settings.pageHeightMm}mm; margin: 0 !important; }`;
            document.head.append(printStyle);
            host.current.replaceChildren(...Array.from(stage.children));
            stage.remove();
            dispose = cleanup;
            setStatus("ready");
            callbacks.current.onReady?.(pages);
          } catch (error) {
            cleanup();
            if (!cancelled) {
              console.error("Book pagination failed", error);
              setStatus("error");
              callbacks.current.onError?.();
            }
          }
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      dispose?.();
    };
  }, [source, settings]);

  return (
    <div
      ref={host}
      className="print-document"
      lang="de"
      aria-busy={status === "updating"}
      data-book-ready={status === "ready" ? "true" : "false"}
      data-book-error={status === "error" ? "true" : "false"}
      data-book-width-mm={settings.pageWidthMm}
      data-book-height-mm={settings.pageHeightMm}
    />
  );
}
