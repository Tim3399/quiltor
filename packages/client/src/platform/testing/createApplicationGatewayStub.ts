import type {
  ApplicationGateway,
  AssistantGateway,
  BackupGateway,
  DocumentsGateway,
  HistoryGateway,
  IdentityGateway,
  ManuscriptGateway,
  MetadataGateway,
  StoryWorldGateway,
  WorldsGateway,
  WritingAssistanceGateway,
} from "../application";

export type ApplicationGatewayOverrides = {
  metadata?: Partial<MetadataGateway>;
  worlds?: Partial<WorldsGateway>;
  identity?: Partial<IdentityGateway>;
  storyWorld?: Partial<StoryWorldGateway>;
  manuscript?: Partial<ManuscriptGateway>;
  backup?: Partial<BackupGateway>;
  history?: Partial<HistoryGateway>;
  assistant?: Partial<AssistantGateway>;
  writingAssistance?: Partial<WritingAssistanceGateway>;
  documents?: Partial<DocumentsGateway>;
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
      open: () => notStubbed("worlds.open"),
      create: () => notStubbed("worlds.create"),
      delete: () => notStubbed("worlds.delete"),
      ...overrides.worlds,
    },
    identity: {
      current: () => notStubbed("identity.current"),
      logout: () => notStubbed("identity.logout"),
      ...overrides.identity,
    },
    storyWorld: {
      load: () => notStubbed("storyWorld.load"),
      save: () => notStubbed("storyWorld.save"),
      ...overrides.storyWorld,
    },
    manuscript: {
      load: () => notStubbed("manuscript.load"),
      save: () => notStubbed("manuscript.save"),
      ...overrides.manuscript,
    },
    backup: {
      status: () => notStubbed("backup.status"),
      saveSnapshot: () => notStubbed("backup.saveSnapshot"),
      loginStatus: () => notStubbed("backup.loginStatus"),
      beginLogin: () => notStubbed("backup.beginLogin"),
      signOut: () => notStubbed("backup.signOut"),
      list: () => notStubbed("backup.list"),
      restore: () => notStubbed("backup.restore"),
      ...overrides.backup,
    },
    history: {
      log: () => notStubbed("history.log"),
      diff: () => notStubbed("history.diff"),
      textVersion: () => notStubbed("history.textVersion"),
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
      bookPdf: () => notStubbed("documents.bookPdf"),
      ...overrides.documents,
    },
  };
}
