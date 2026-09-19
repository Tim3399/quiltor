import type { FigureState } from "../../modules/story-world";
import type { VersionedDocumentGateway } from "./versionedDocument";

export interface StoryWorldGateway extends VersionedDocumentGateway<FigureState> {}
