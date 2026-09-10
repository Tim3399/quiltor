import { Maximize, PanelTop, RefreshCw, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { TextField, ToolbarButton } from "../../design";
import { useI18n } from "../../i18n";
import { BookDocument, type BookPage } from "./BookDocument";
import { resolveBookLayout } from "./bookLayout";
import type { Manuscript } from "./model";
import "./PrintPreviewWorkspace.css";

type Zoom = "page" | "width" | `${number}`;

interface PrintPreviewWorkspaceProps {
  manuscript: Manuscript;
  worldTitle?: string;
  requestedChapterId?: string;
  requestedChapterRequestId: number;
  onCurrentChapterId?: (chapterId: string) => void;
}

export function PrintPreviewWorkspace({
  manuscript,
  worldTitle,
  requestedChapterId,
  requestedChapterRequestId,
  onCurrentChapterId,
}: PrintPreviewWorkspaceProps) {
  const { t } = useI18n();
  const viewportRef = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState<BookPage[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [status, setStatus] = useState<"refreshing" | "ready" | "error">("refreshing");
  const [zoom, setZoom] = useState<Zoom>("page");
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [documentHeight, setDocumentHeight] = useState(0);
  const layout = resolveBookLayout(manuscript.bookLayout);
  const pageWidth = (layout.pageWidthMm * 96) / 25.4;
  const pageHeight = (layout.pageHeightMm * 96) / 25.4;
  const scale = useMemo(() => {
    if (/^\d+$/.test(zoom)) return Math.max(0.5, Math.min(2, Number(zoom) / 100));
    if (!viewportSize.width || !viewportSize.height) return 1;
    const widthFit = Math.max(0.1, (viewportSize.width - 64) / pageWidth);
    return zoom === "width"
      ? widthFit
      : Math.max(0.1, Math.min(widthFit, (viewportSize.height - 80) / pageHeight));
  }, [pageHeight, pageWidth, viewportSize, zoom]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const update = () =>
      setViewportSize({ width: viewport.clientWidth, height: viewport.clientHeight });
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!requestedChapterId || !Number.isFinite(requestedChapterRequestId) || status !== "ready")
      return;
    const target = [
      ...(viewportRef.current?.querySelectorAll<HTMLElement>(".pagedjs_page") ?? []),
    ].find(
      (page) =>
        page.dataset.chapterId === requestedChapterId && page.dataset.chapterStart === "true",
    );
    target?.scrollIntoView?.({ block: "start" });
    const number = Number(target?.dataset.pageNumber);
    if (Number.isFinite(number)) setCurrentPage(number);
  }, [requestedChapterId, requestedChapterRequestId, status]);

  const updateCurrentPage = () => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const center = viewport.getBoundingClientRect().top + viewport.clientHeight / 2;
    const renderedPages = [...viewport.querySelectorAll<HTMLElement>(".pagedjs_page")];
    const nearest = renderedPages.reduce<HTMLElement | null>((best, page) => {
      if (!best) return page;
      const bounds = page.getBoundingClientRect();
      const bestBounds = best.getBoundingClientRect();
      const distance = Math.abs(bounds.top + bounds.height / 2 - center);
      const bestDistance = Math.abs(bestBounds.top + bestBounds.height / 2 - center);
      return distance < bestDistance ? page : best;
    }, null);
    const number = Number(nearest?.dataset.pageNumber);
    if (!Number.isFinite(number)) return;
    setCurrentPage(number);
    const chapterId = nearest?.dataset.chapterId;
    if (chapterId) onCurrentChapterId?.(chapterId);
  };

  return (
    <section className="print-preview" aria-label={t("printPreview")}>
      <div className="print-preview__toolbar">
        <fieldset className="print-preview__zoom-presets" aria-label={t("previewZoom")}>
          <ToolbarButton
            label={t("fitPage")}
            icon={<Maximize />}
            aria-pressed={zoom === "page"}
            onClick={() => setZoom("page")}
          />
          <ToolbarButton
            label={t("fitWidth")}
            icon={<PanelTop />}
            aria-pressed={zoom === "width"}
            onClick={() => setZoom("width")}
          />
        </fieldset>
        <TextField
          fieldClassName="print-preview__zoom-select"
          label={t("previewZoom")}
          labelHidden
          type="number"
          inputMode="numeric"
          min={50}
          max={200}
          step={1}
          value={/^\d+$/.test(zoom) ? zoom : String(Math.round(scale * 100))}
          onChange={(event) => {
            const value = Number(event.target.value);
            if (Number.isFinite(value) && value >= 50 && value <= 200)
              setZoom(String(value) as Zoom);
          }}
        />
        <span className="print-preview__page-status" aria-live="polite">
          {t("previewPageStatus", { current: String(currentPage), total: String(pages.length) })}
        </span>
      </div>
      <div ref={viewportRef} className="print-preview__viewport" onScroll={updateCurrentPage}>
        <div
          className="print-preview__document-space"
          style={
            {
              "--preview-scale": scale,
              "--preview-document-width": `${pageWidth}px`,
              "--preview-page-count": Math.max(1, pages.length),
              "--preview-document-height": `${documentHeight || Math.max(1, pages.length) * pageHeight}px`,
            } as React.CSSProperties
          }
        >
          <div className="print-preview__scaled-document">
            <BookDocument
              worldTitle={worldTitle}
              manuscript={manuscript}
              onUpdating={() => setStatus("refreshing")}
              onReady={(nextPages) => {
                setPages(nextPages);
                setCurrentPage((current) => Math.min(Math.max(1, current), nextPages.length || 1));
                setStatus("ready");
                requestAnimationFrame(() => {
                  const rendered =
                    viewportRef.current?.querySelector<HTMLElement>(".pagedjs_pages");
                  if (rendered) setDocumentHeight(rendered.scrollHeight);
                });
              }}
              onError={() => setStatus("error")}
            />
          </div>
        </div>
        {status !== "ready" && (
          <div className={`print-preview__state is-${status}`} role="status">
            {status === "refreshing" ? (
              <RefreshCw aria-hidden="true" />
            ) : (
              <Search aria-hidden="true" />
            )}
            <span>{status === "refreshing" ? t("previewRefreshing") : t("previewError")}</span>
          </div>
        )}
      </div>
    </section>
  );
}
