// Choosing the assistant's AI engine (T-61). Part 7 holds the in-browser AI's texts, T-264 adds the own key's.
export const assistantClientAi = {
  assistantEngineLabel: "AI engine",
  assistantEngineServer: "Server AI",
  assistantEngineBrowser: "In the browser",
  assistantEngineOwnKey: "Own key",
  errorAssistantClientJobRunning:
    "A job on your own engine is already running in another tab. Wait until it has finished.",
  errorAssistantClientAiDisabled: "On this server the assistant can only use the server AI.",
  webllmTitle: "AI in the browser",
  webllmChecking: "Checking whether the model is already on this device …",
  webllmAbsent:
    "The model is not on this device yet. It is about 2.5 GB and stays stored in the browser afterwards.",
  webllmDownload: "Download model",
  webllmDownloading: "Loading the model …",
  webllmCached: "The model is on this device and loads with the first request.",
  webllmReady: "The model is loaded and runs on this device.",
  webllmRemoveModel: "Remove model",
  webllmError: "The model could not be loaded: {error}",
};
