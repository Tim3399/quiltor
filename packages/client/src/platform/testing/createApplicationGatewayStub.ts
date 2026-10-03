import type {
  ApplicationGateway,
  AssistantGateway,
  BackupGateway,
  DocumentsGateway,
  HistoryGateway,
  IdentityGateway,
  ManuscriptGateway,
  ManuscriptImportGateway,
  MetadataGateway,
  PlaceMapsGateway,
  ProjectTransferGateway,
  StoryboardsGateway,
  StoryWorldGateway,
  SynchronizationGateway,
  WorldsGateway,
  WritingAssistanceGateway,
} from "../application";

export type ApplicationGatewayOverrides = {
  metadata?: Partial<MetadataGateway>;
  worlds?: Partial<WorldsGateway>;
  identity?: Partial<IdentityGateway>;
  storyWorld?: Partial<StoryWorldGateway>;
  storyboards?: Partial<StoryboardsGateway>;
  manuscript?: Partial<ManuscriptGateway>;
  manuscriptImport?: Partial<ManuscriptImportGateway>;
  backup?: Partial<BackupGateway>;
  history?: Partial<HistoryGateway>;
  assistant?: Partial<AssistantGateway>;
  writingAssistance?: Partial<WritingAssistanceGateway>;
  documents?: Partial<DocumentsGateway>;
  placeMaps?: Partial<PlaceMapsGateway>;
  projectTransfer?: Partial<ProjectTransferGateway>;
  synchronization?: Partial<SynchronizationGateway>;
};

function notStubbed(method: string): Promise<never> {
  return Promise.reject(new Error(`Application gateway method not stubbed: ${method}`));
}

/** Complete test composition: overrides stay local while new ports fail loudly by default. */
export function createApplicationGatewayStub(
  overrides: ApplicationGatewayOverrides = {},
): ApplicationGateway {
  return {
    metadata: {
      version: () => notStubbed("metadata.version"),
      ...overrides.metadata,
    },
    worlds: {
      select: () => {},
      list: () => notStubbed("worlds.list"),
      listTrash: () => notStubbed("worlds.listTrash"),
      open: () => notStubbed("worlds.open"),
      create: () => notStubbed("worlds.create"),
      delete: () => notStubbed("worlds.delete"),
      restore: () => notStubbed("worlds.restore"),
      purge: () => notStubbed("worlds.purge"),
      ...overrides.worlds,
    },
    identity: {
      current: () => notStubbed("identity.current"),
      logout: () => notStubbed("identity.logout"),
      ...overrides.identity,
    },
    storyWorld: {
      load: () => notStubbed("storyWorld.load"),
      peek: () => notStubbed("storyWorld.peek"),
      adoptPersisted: (versioned) => versioned.document,
      save: () => notStubbed("storyWorld.save"),
      saveExpected: () => notStubbed("storyWorld.saveExpected"),
      ...overrides.storyWorld,
    },
    storyboards: {
      load: () => notStubbed("storyboards.load"),
      peek: () => notStubbed("storyboards.peek"),
      adoptPersisted: (versioned) => versioned.document,
      save: () => notStubbed("storyboards.save"),
      saveExpected: () => notStubbed("storyboards.saveExpected"),
      ...overrides.storyboards,
    },
    manuscript: {
      load: () => notStubbed("manuscript.load"),
      peek: () => notStubbed("manuscript.peek"),
      adoptPersisted: (versioned) => versioned.document,
      save: () => notStubbed("manuscript.save"),
      saveExpected: () => notStubbed("manuscript.saveExpected"),
      ...overrides.manuscript,
    },
    manuscriptImport: {
      createRequestId: () => "00000000-0000-4000-8000-000000000000",
      preview: () => notStubbed("manuscriptImport.preview"),
      importManuscript: () => notStubbed("manuscriptImport.importManuscript"),
      ...overrides.manuscriptImport,
    },
    backup: {
      status: () => notStubbed("backup.status"),
      saveSnapshot: () => notStubbed("backup.saveSnapshot"),
      loginStatus: () => notStubbed("backup.loginStatus"),
      beginLogin: () => notStubbed("backup.beginLogin"),
      signOut: () => notStubbed("backup.signOut"),
      list: () => notStubbed("backup.list"),
      location: () => notStubbed("backup.location"),
      preview: () => notStubbed("backup.preview"),
      restore: () => notStubbed("backup.restore"),
      ...overrides.backup,
    },
    history: {
      log: () => notStubbed("history.log"),
      diff: () => notStubbed("history.diff"),
      textVersion: () => notStubbed("history.textVersion"),
      chapterComparison: () => notStubbed("history.chapterComparison"),
      ...overrides.history,
    },
    assistant: {
      status: () => notStubbed("assistant.status"),
      install: () => notStubbed("assistant.install"),
      installStatus: () => notStubbed("assistant.installStatus"),
      jobStatus: () => notStubbed("assistant.jobStatus"),
      cancelJob: () => notStubbed("assistant.cancelJob"),
      wait: () => notStubbed("assistant.wait"),
      chat: () => notStubbed("assistant.chat"),
      progress: () => notStubbed("assistant.progress"),
      ...overrides.assistant,
    },
    writingAssistance: {
      status: () => notStubbed("writingAssistance.status"),
      installData: () => notStubbed("writingAssistance.installData"),
      lookup: () => notStubbed("writingAssistance.lookup"),
      installGrammar: () => notStubbed("writingAssistance.installGrammar"),
      checkGrammar: () => notStubbed("writingAssistance.checkGrammar"),
      ...overrides.writingAssistance,
    },
    documents: {
      renderBookPdf: () => notStubbed("documents.renderBookPdf"),
      saveBookPdf: () => notStubbed("documents.saveBookPdf"),
      bookPdf: () => notStubbed("documents.bookPdf"),
      previewManuscriptDocx: () => notStubbed("documents.previewManuscriptDocx"),
      renderManuscriptDocx: () => notStubbed("documents.renderManuscriptDocx"),
      saveManuscriptDocx: () => notStubbed("documents.saveManuscriptDocx"),
      ...overrides.documents,
    },
    placeMaps: {
      store: () => notStubbed("placeMaps.store"),
      sourceUrl: (imageId: string) => `/api/place-map?id=${imageId}`,
      ...overrides.placeMaps,
    },
    projectTransfer: {
      exportProject: () => notStubbed("projectTransfer.exportProject"),
      preview: () => notStubbed("projectTransfer.preview"),
      importProject: () => notStubbed("projectTransfer.importProject"),
      ...overrides.projectTransfer,
    },
    synchronization: {
      status: () => notStubbed("synchronization.status"),
      preview: () => notStubbed("synchronization.preview"),
      synchronize: () => notStubbed("synchronization.synchronize"),
      ...overrides.synchronization,
    },
  };
}
