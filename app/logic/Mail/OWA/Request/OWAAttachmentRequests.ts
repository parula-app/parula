import { OWARequest } from "./OWARequest";
import type { Attachment } from "../../../Abstract/Attachment";

export function owaGetAttachmentsRequest(attachmentIDs: string[]): OWARequest {
  return new OWARequest("GetAttachment", {
    __type: "GetAttachmentRequest:#Exchange",
    AttachmentIds: attachmentIDs.map(attachmentID => ({
      __type: "AttachmentId:#Exchange",
      Id: attachmentID,
    })),
  });
}

export function owaCreateAttachmentRequest(itemID: string, attachment: Attachment): OWARequest {
  return new OWARequest("CreateAttachment", {
    __type: "CreateAttachmentRequest:#Exchange",
    Attachments: [{
      __type: "FileAttachment:#Exchange",
      Name: attachment.filename,
      ContentType: attachment.mimeType,
      Size: attachment.size,
      IsInline: false,
      Content: "",
    }],
    ParentItemId: {
      __type: "ItemId:#Exchange",
      Id: itemID,
    },
  });
}

export function owaDeleteAttachmentsRequest(attachmentIDs: string[]): OWARequest {
  return new OWARequest("DeleteAttachment", {
    __type: "DeleteAttachmentRequest:#Exchange",
    AttachmentIds: attachmentIDs.map(attachmentID => ({
      __type: "AttachmentId:#Exchange",
      Id: attachmentID,
    })),
  });
}
