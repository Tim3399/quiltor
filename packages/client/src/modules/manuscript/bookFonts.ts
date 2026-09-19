import type { BookLayoutSettings } from "./bookLayout";

export const BOOK_FONT_FAMILIES: Record<BookLayoutSettings["fontFamily"], string> = {
  "eb-garamond": "EB Garamond Variable",
  literata: "Literata Variable",
  "source-serif-4": "Source Serif 4 Variable",
  "crimson-pro": "Crimson Pro Variable",
  "libre-baskerville": "Libre Baskerville",
};

/** Font files ship with the client; pagination never depends on installed system fonts. */
export async function loadBookFont(font: BookLayoutSettings["fontFamily"]) {
  switch (font) {
    case "eb-garamond":
      await Promise.all([
        import("@fontsource-variable/eb-garamond/wght.css"),
        import("@fontsource-variable/eb-garamond/wght-italic.css"),
      ]);
      break;
    case "literata":
      await Promise.all([
        import("@fontsource-variable/literata/wght.css"),
        import("@fontsource-variable/literata/wght-italic.css"),
      ]);
      break;
    case "source-serif-4":
      await Promise.all([
        import("@fontsource-variable/source-serif-4/wght.css"),
        import("@fontsource-variable/source-serif-4/wght-italic.css"),
      ]);
      break;
    case "crimson-pro":
      await Promise.all([
        import("@fontsource-variable/crimson-pro/wght.css"),
        import("@fontsource-variable/crimson-pro/wght-italic.css"),
      ]);
      break;
    case "libre-baskerville":
      await Promise.all([
        import("@fontsource/libre-baskerville/400.css"),
        import("@fontsource/libre-baskerville/700.css"),
        import("@fontsource/libre-baskerville/400-italic.css"),
      ]);
      break;
  }
  const family = BOOK_FONT_FAMILIES[font];
  for (const style of ["normal 400", "normal 700", "italic 400", "italic 700"]) {
    const loaded = await document.fonts.load(`${style} 12pt "${family}"`, "Buch ÄÖÜäöüß");
    if (!loaded.length) throw new Error(`Book font could not be loaded: ${family}`);
  }
  await document.fonts.ready;
}
