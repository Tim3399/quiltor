import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../../packages/client/src/design/index.css";
import { DesignGallery } from "../../packages/client/src/design/testing/gallery/DesignGallery";

const container = document.getElementById("root");
if (!container) throw new Error("Design gallery root is missing");

createRoot(container).render(
  <StrictMode>
    <DesignGallery />
  </StrictMode>,
);
