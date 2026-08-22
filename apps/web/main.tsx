import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@xyflow/react/dist/style.css";
import "../../packages/client/src/design/index.css";
import { App } from "../../packages/client/src/app/Application";
import { I18nProvider } from "../../packages/client/src/i18n";
import { createPlatformGateway } from "../../packages/client/src/platform/createPlatformGateway";
import {
  configureQuiltorClient,
  createQuiltorClient,
} from "../../packages/client/src/platform/QuiltorClient";
import { createHttpApplicationGateway } from "../../packages/client/src/platform/http";

const platform = createPlatformGateway();
configureQuiltorClient(createQuiltorClient(platform, createHttpApplicationGateway(platform)));

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </StrictMode>,
);
