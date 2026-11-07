import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@xyflow/react/dist/style.css";
import "../../packages/client/src/design/index.css";
import { DesignGallery } from "../../packages/client/src/design/testing/gallery/DesignGallery";
import { StoryNodeFavouritesScene } from "../../packages/client/src/modules/story-world";

const container = document.getElementById("root");
if (!container) throw new Error("Design gallery root is missing");

// A scene is a module component the design system's own catalogue may not import (its registry
// is closed over the public design folders). It lives beside the gallery instead and is opened
// by name: `/?scene=story-node-favourites&theme=dark&circle=empty`.
const params = new URLSearchParams(window.location.search);
const theme = params.get("theme") === "dark" ? "dark" : "light";
const page =
  params.get("scene") === "story-node-favourites" ? (
    <StoryNodeFavouritesScene
      theme={theme}
      circle={params.get("circle") === "empty" ? "empty" : "star"}
    />
  ) : (
    <DesignGallery />
  );

createRoot(container).render(<StrictMode>{page}</StrictMode>);
