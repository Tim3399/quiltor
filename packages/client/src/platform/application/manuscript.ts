import type { Manuscript } from "../../modules/manuscript";
import type { VersionedDocumentGateway } from "./versionedDocument";

export interface ManuscriptGateway extends VersionedDocumentGateway<Manuscript> {}
