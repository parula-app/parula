import type { TID, TUTCDateTime } from "../../Mail/JMAP/TJMAPGeneric";

/** <https://www.ietf.org/archive/id/draft-ietf-jmap-filenode-18.html#name-filenode-objects>
 * Up to draft -14, `nodeType` and `type` instead of `@type` and `mediaType` */
export interface TJMAPFileNode {
  "@type"?: "File" | "Directory" | "SymLink" | string;
  nodeType?: "file" | "directory" | "symlink" | string;
  readonly id: TID;
  parentId: TID | null;
  name: string;
  created?: TUTCDateTime;
  modified?: TUTCDateTime | null;
  accessed?: TUTCDateTime | null;
  readonly changed?: TUTCDateTime;
  blobId?: TID;
  readonly size?: number;
  mediaType?: string;
  type?: string;
  executable?: boolean;
  role?: string | null;
  isSubscribed?: boolean;
  readonly myRights?: TJMAPFilesRights;
  shareWith?: Record<TID, TJMAPFilesRights> | null;
  target?: string[];
}

/** <https://www.ietf.org/archive/id/draft-ietf-jmap-filenode-18.html#name-container-properties> */
export interface TJMAPFilesRights {
  mayRead: boolean;
  mayAddChildren: boolean;
  mayRename: boolean;
  mayDelete: boolean;
  mayModifyContent: boolean;
  mayShare: boolean;
}
