import { Person } from '../../Abstract/Person';
import type { URLString } from '../../util/util';
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";

export class ExchangePerson extends Person {
  /** The AttachmentId of the picture on the server,
   * or the empty string if the contact has no picture there.
   * EWS and OWA only: ActiveSync sends the picture inline. */
  pictureAttachmentID = "";
  /** The picture that the server has.
   * Exchange saves the picture separately from the rest of the contact,
   * so upload it only when the user changed it.
   * Not saved in the database, so the first save after a restart uploads it again. */
  protected pictureOnServer: URLString | null | undefined;

  /** Whether the user changed the picture since we last got it from the server */
  protected get pictureChanged(): boolean {
    return this.picture != this.pictureOnServer;
  }

  /** Whether the server has a picture that we did not download yet */
  get needsPicture(): boolean {
    return !!this.pictureAttachmentID && !this.picture;
  }

  /** A new attachment ID means that the picture changed on the server,
   * so that we download pictures only when needed, @see `needsPicture`
   * @param attachments of the contact, only metadata without the contents */
  pictureChangedOnServer(attachments: Record<string, any>[]): boolean {
    let pictureAttachment = attachments.find(attachment => sanitize.boolean(attachment.IsContactPhoto, false));
    let pictureAttachmentID = sanitize.nonemptystring(pictureAttachment?.AttachmentId.Id, "");
    let changed = pictureAttachmentID != this.pictureAttachmentID;
    if (changed) {
      this.pictureAttachmentID = pictureAttachmentID;
      // The new picture comes in a separate download
      this.picture = null;
    }
    this.pictureOnServer = this.picture;
    return changed;
  }

  /** @param base64 the picture contents, as the server sent them
   * @param mimeType as the server declared it */
  pictureFromServer(base64: string, mimeType: string = kPictureMIMEType) {
    if (!mimeType.startsWith("image/")) {
      mimeType = kPictureMIMEType;
    }
    this.picture = sanitize.url(`data:${mimeType};base64,${base64}`, null, ["data"]);
    this.pictureOnServer = this.picture;
  }
}

/** Exchange saves the contact picture as a JPEG file attached to the contact */
export const kPictureFilename = "ContactPicture.jpg";
const kPictureMIMEType = "image/jpeg";
