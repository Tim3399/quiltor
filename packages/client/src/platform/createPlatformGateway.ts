import type { FileGateway, PlatformGateway } from "./PlatformGateway";
import {
  browserClipboard,
  browserExternalNavigation,
  browserFiles,
  browserPreferences,
} from "./browser/browserPlatformGateway";
import { desktopFileGateway } from "./desktop/desktopFileGateway";
import { safeFileName } from "./safeFileName";

const hostFiles: FileGateway = {
  save(name, content) {
    return (desktopFileGateway() ?? browserFiles).save(name, content);
  },
};

export function createPlatformGateway(overrides: Partial<PlatformGateway> = {}): PlatformGateway {
  const selectedFiles = overrides.files ?? hostFiles;
  return {
    preferences: browserPreferences,
    clipboard: browserClipboard,
    externalNavigation: browserExternalNavigation,
    ...overrides,
    files: {
      save: (name, content) => selectedFiles.save(safeFileName(name), content),
    },
  };
}
