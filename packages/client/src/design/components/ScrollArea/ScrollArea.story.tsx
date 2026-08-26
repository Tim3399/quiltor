import { ScrollArea } from "./ScrollArea";

const chapters = Array.from({ length: 14 }, (_, index) => `Kapitel ${index + 1}`);

export function Vertical() {
  return (
    <ScrollArea
      as="ol"
      aria-label="Kapitel"
      surface="panel"
      tabIndex={0}
      style={{ height: 180, margin: 0, padding: "var(--space-16) var(--space-32)" }}
    >
      {chapters.map((chapter) => (
        <li key={chapter} style={{ paddingBlock: "var(--space-8)" }}>
          {chapter}
        </li>
      ))}
    </ScrollArea>
  );
}

export function Horizontal() {
  return (
    <ScrollArea
      as="section"
      aria-label="Szenenfolge"
      axis="x"
      surface="paper"
      tabIndex={0}
      style={{ maxWidth: "100%" }}
    >
      <div
        style={{
          display: "flex",
          width: "max-content",
          gap: "var(--space-12)",
          padding: "var(--space-16)",
        }}
      >
        {chapters.slice(0, 8).map((chapter) => (
          <article
            key={chapter}
            style={{
              width: 180,
              padding: "var(--space-16)",
              border: "1px solid var(--line)",
              borderRadius: "var(--radius-lg)",
              background: "var(--panel)",
            }}
          >
            <strong>{chapter}</strong>
            <p>Eine Szene auf der horizontalen Zeitachse.</p>
          </article>
        ))}
      </div>
    </ScrollArea>
  );
}

export function BothAxes() {
  return (
    <ScrollArea
      aria-label="Weltkarte"
      axis="both"
      surface="canvas"
      role="region"
      tabIndex={0}
      style={{ width: "100%", height: 220 }}
    >
      <div
        style={{
          minWidth: 760,
          minHeight: 420,
          padding: "var(--space-24)",
          background:
            "linear-gradient(var(--line) 1px, var(--transparent) 1px), linear-gradient(90deg, var(--line) 1px, var(--transparent) 1px)",
          backgroundSize: "var(--space-32) var(--space-32)",
        }}
      >
        <strong>Die bekannten Reiche</strong>
      </div>
    </ScrollArea>
  );
}
