import { useEffect } from "react";
import { designStories } from "./registry";
import "./DesignGallery.css";

type GalleryTheme = "light" | "dark";

function selectedTheme(params: URLSearchParams): GalleryTheme {
  return params.get("theme") === "dark" ? "dark" : "light";
}

function storyUrl(id: string, theme: GalleryTheme) {
  const params = new URLSearchParams({ story: id, theme });
  return `/?${params.toString()}`;
}

export function DesignGallery() {
  const params = new URLSearchParams(window.location.search);
  const theme = selectedTheme(params);
  const selectedId = params.get("story");
  const story = designStories.find((candidate) => candidate.id === selectedId);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  }, [theme]);

  if (selectedId && !story) {
    return (
      <main className="design-gallery design-gallery--message">
        <h1>Unbekannte Design-Story</h1>
        <code>{selectedId}</code>
        <a href={`/?theme=${theme}`}>Zum Katalog</a>
      </main>
    );
  }

  if (story) {
    const Story = story.component;
    const otherTheme: GalleryTheme = theme === "light" ? "dark" : "light";
    return (
      <main className="design-story-page">
        <header className="design-story-header">
          <a href={`/?theme=${theme}`}>Katalog</a>
          <span>
            {story.group} / {story.title}
          </span>
          <a href={storyUrl(story.id, otherTheme)}>{otherTheme}</a>
        </header>
        <div className="design-story-canvas" data-design-story={story.id} data-design-theme={theme}>
          <Story />
        </div>
      </main>
    );
  }

  const groups = new Map<string, (typeof designStories)[number][]>();
  for (const candidate of designStories) {
    const stories = groups.get(candidate.group) ?? [];
    stories.push(candidate);
    groups.set(candidate.group, stories);
  }
  return (
    <main className="design-gallery">
      <header className="design-gallery__header">
        <div>
          <p>Quiltor</p>
          <h1>Design-System</h1>
        </div>
        <nav aria-label="Theme">
          <a aria-current={theme === "light" ? "page" : undefined} href="/?theme=light">
            Light
          </a>
          <a aria-current={theme === "dark" ? "page" : undefined} href="/?theme=dark">
            Dark
          </a>
        </nav>
      </header>
      {[...groups].map(([group, stories]) => (
        <section key={group} className="design-gallery__group">
          <h2>{group}</h2>
          <div className="design-gallery__stories">
            {stories.map((candidate) => (
              <a
                key={candidate.id}
                href={storyUrl(candidate.id, theme)}
                data-design-story-link={candidate.id}
              >
                <strong>{candidate.title}</strong>
                <span>{candidate.status ?? "experimental"}</span>
                <code>{candidate.id}</code>
              </a>
            ))}
          </div>
        </section>
      ))}
    </main>
  );
}
