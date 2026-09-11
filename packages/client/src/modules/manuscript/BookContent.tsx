import { Fragment } from "react";
import { messageCatalog } from "../../i18n";
import { orderedChapters } from "./binder/manuscriptTree";
import type { BookLayoutSettings } from "./bookLayout";
import { bodyParagraphs, markedSegments } from "./marks";
import type { Chapter, Manuscript } from "./model";

export const isSceneBreak = (text: string) => /^\s*([*⁂◆]|\*\s*\*\s*\*)\s*$/.test(text);

// The manuscript language, rather than the device's UI preference, owns book copy.
const copy = messageCatalog("de");

export function chapterNumber(index: number, style: BookLayoutSettings["chapterNumberStyle"]) {
  if (style === "padded") return String(index + 1).padStart(2, "0");
  if (style === "chapter") return `${copy.chapter} ${index + 1}`;
  return String(index + 1);
}

/** Semantic source shared by screen pagination and every PDF host. */
export function BookContent({
  manuscript,
  settings,
  worldTitle,
  date,
}: {
  manuscript: Manuscript;
  settings: BookLayoutSettings;
  worldTitle?: string;
  date: string;
}) {
  return (
    <article className="book-content" lang="de">
      <section className="book-title-page">
        <div className="book-title-page__main">
          {settings.showNovelLabel && (
            <span className="book-title-page__label">{copy.novelLabel}</span>
          )}
          <h1>{settings.bookTitle || worldTitle || copy.untitledWorld}</h1>
          {settings.subtitle && <p className="book-title-page__subtitle">{settings.subtitle}</p>}
          {settings.author && <p className="book-title-page__author">{settings.author}</p>}
          {(settings.series || settings.volume) && (
            <p className="book-title-page__series">
              {settings.series}
              {settings.series && settings.volume ? " · " : ""}
              {settings.volume}
            </p>
          )}
          <i className="book-title-page__ornament" aria-hidden="true">
            ◆
          </i>
        </div>
        <footer className="book-title-page__footer">
          {[settings.showVersion ? copy.manuscriptVersionLabel : "", settings.showDate ? date : ""]
            .filter(Boolean)
            .join(" · ")}
        </footer>
      </section>
      {orderedChapters(manuscript).map((chapter, chapterIndex) => {
        let firstParagraph = true;
        return (
          <section className="book-chapter" data-chapter-id={chapter.id} key={chapter.id}>
            <header className="book-chapter__heading" data-chapter-heading={chapter.id}>
              {settings.chapterNumber && (
                <span className="book-chapter__number">
                  {chapterNumber(chapterIndex, settings.chapterNumberStyle)}
                </span>
              )}
              {settings.chapterTitle && <h2>{chapter.title || copy.untitled}</h2>}
            </header>
            {bodyParagraphs(chapter.body).map((paragraph) => {
              if (isSceneBreak(paragraph.text)) {
                return (
                  <div className="book-scene-break" key={paragraph.from}>
                    {settings.sceneSymbol || "\u00a0"}
                  </div>
                );
              }
              const first = firstParagraph;
              firstParagraph = false;
              return (
                <p
                  className={`book-paragraph${first ? " book-paragraph--first" : ""}`}
                  data-paragraph-from={paragraph.from}
                  key={paragraph.from}
                >
                  {printedRuns(paragraph, chapter.marks)}
                </p>
              );
            })}
          </section>
        );
      })}
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
