import type { StoryboardState } from "../../modules/storyboard";
import type { VersionedDocumentGateway } from "./versionedDocument";

export interface StoryboardsGateway extends VersionedDocumentGateway<StoryboardState> {}
