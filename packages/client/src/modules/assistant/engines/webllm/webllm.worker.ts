import { WebWorkerMLCEngineHandler } from "@mlc-ai/web-llm";

// The in-browser model runs here, so inference never blocks the page (T-61 part 7).
const handler = new WebWorkerMLCEngineHandler();
self.onmessage = (message: MessageEvent) => handler.onmessage(message);
