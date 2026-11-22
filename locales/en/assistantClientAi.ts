// Choosing the assistant's AI engine (T-61). Part 7 holds the in-browser AI's texts, T-264 adds the own key's.
export const assistantClientAi = {
  assistantEngineLabel: "AI engine",
  assistantEngineServer: "Server AI",
  // Without an identity the server model computes on the author's own computer (T-275).
  assistantEngineLocal: "On this computer",
  assistantEngineServerLocked: "The server AI is only available with premium access.",
  assistantEngineBrowser: "In the browser",
  assistantEngineNone: "No AI available",
  assistantEngineBrowserUnsupported:
    "The AI in the browser needs WebGPU, which this browser does not offer. A current browser with WebGPU on a device with a graphics chip can run it.",
  assistantEngineOwnKey: "Own key",
  errorAssistantClientJobRunning:
    "A job on your own engine is already running in another tab. Wait until it has finished.",
  errorAssistantClientAiDisabled: "On this server the assistant can only use the server AI.",
  assistantEngineErrorModelNotLoaded:
    "The model for the AI in the browser is not on this device yet. Download it first under “AI in the browser” above.",
  assistantEngineErrorUnavailable:
    "The AI in the browser could not answer. Try again or reload the page.",
  assistantEngineErrorClientUnavailable:
    "This browser did not take the request. Keep the assistant's tab open and try again.",
  assistantEngineErrorProvider: "The provider refused the request. Check your key and try again.",
  assistantEngineErrorContextTooLarge:
    "The request is too large for the model in the browser. Choose another engine under “AI engine” above.",
  assistantErrorWorldTooLarge:
    "This world is too large to update from the manuscript: the world state alone fills the model’s window. Choosing different chapters does not change that.",
  assistantErrorChapterTooLong:
    "This chapter is too long to analyse. Split it into several chapters, for example at scene breaks, and then update the world chapter by chapter.",
  assistantErrorExtractionIncomplete:
    "The chapter could not be analysed in full. Nothing was kept.",
  assistantErrorExtractionPartFailed:
    "The analysis stopped in a later part of the chapter. Nothing was kept; a new attempt starts again with the first part.",
  assistantEngineErrorUnknown: "Your own engine could not run the request.",
  webllmTitle: "AI in the browser",
  webllmChecking: "Checking whether the model is already on this device …",
  webllmAbsent:
    "The model is not on this device yet. It is about 2.5 GB and stays stored in the browser afterwards.",
  webllmDownload: "Download model",
  webllmDownloading: "Loading the model …",
  webllmCached: "The model is on this device and loads with the first request.",
  webllmReady: "The model is loaded and runs on this device.",
  webllmReadyStatus: "In the browser · loaded",
  webllmModelActions: "Model actions",
  webllmRemoveModel: "Remove model",
  webllmError: "The model could not be loaded: {error}",
};
