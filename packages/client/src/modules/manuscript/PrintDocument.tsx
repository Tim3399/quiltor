import { Fragment } from "react";
import { useI18n } from "../../i18n";
import { bodyParagraphs, markedSegments } from "./marks";
import type { Chapter, Manuscript } from "./model";
import "./PrintDocument.css";

interface PrintDocumentProps {
  worldTitle?: string;
  manuscript: Manuscript;
}

export function PrintDocument({ worldTitle, manuscript }: PrintDocumentProps) {
  const { t, locale } = useI18n();

  return (
    <article className="print-document" aria-hidden="true" lang="de">
      <section className="book-title-page">
        <div>
          <span>{t("novelLabel")}</span>
          <h1>{worldTitle || t("untitledWorld")}</h1>
          <i aria-hidden="true">◆</i>
        </div>
        <footer>
          {t("manuscriptVersionLabel")} · {new Date().toLocaleDateString(locale)}
        </footer>
      </section>
      {manuscript.chapters.map((chapter, chapterIndex) => (
        <section className="book-chapter" key={chapter.id}>
          <header>
            <span>{String(chapterIndex + 1).padStart(2, "0")}</span>
            <h2>{chapter.title || t("untitled")}</h2>
          </header>
          {bodyParagraphs(chapter.body).map((paragraph, index) =>
            /^\s*([*⁂◆]|\*\s*\*\s*\*)\s*$/.test(paragraph.text) ? (
              <div className="scene-break" key={index}>
                ⁂
              </div>
            ) : (
              <p key={index}>{printedRuns(paragraph, chapter.marks)}</p>
            ),
          )}
        </section>
      ))}
    </article>
  );
}

function printedRuns(paragraph: { text: string; from: number }, marks: Chapter["marks"]) {
  return markedSegments(paragraph.text, paragraph.from, marks).map((segment, index) => {
    const text = segment.text.replace(/\n/g, " ");
    if (segment.bold && segment.italic)
      return (
        <em key={index}>
          <strong>{text}</strong>
        </em>
      );
    if (segment.bold) return <strong key={index}>{text}</strong>;
    if (segment.italic) return <em key={index}>{text}</em>;
    return <Fragment key={index}>{text}</Fragment>;
  });
}
