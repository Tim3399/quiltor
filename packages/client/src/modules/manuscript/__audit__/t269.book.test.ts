/**
 * T-269 phase 2, package C, check 5.1 (implementer/T-269-audit-client.md): the book markup
 * that Paged.js parses as HTML is built by React, so author, import and model text stays text.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BookContent } from "../BookContent";
import { DEFAULT_BOOK_LAYOUT } from "../bookLayout";

const PAYLOAD = `<img src=x onerror="alert(1)"><script>alert(2)</script>`;

describe("T-269 5.1 book markup", () => {
  it("escapes chapter titles, bodies, the author and the world title", () => {
    const markup = renderToStaticMarkup(
      createElement(BookContent, {
        date: "",
        worldTitle: PAYLOAD,
        settings: { ...DEFAULT_BOOK_LAYOUT, author: PAYLOAD },
        manuscript: { chapters: [{ id: "c1", title: PAYLOAD, body: PAYLOAD, note: "" }] },
      }),
    );
    expect(markup).not.toMatch(/<img|<script/i);
    expect(markup).toContain("&lt;img");
  });
});
