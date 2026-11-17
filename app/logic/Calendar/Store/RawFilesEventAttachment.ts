import type { Event } from "../Event";
import { SQLEvent } from "../SQL/SQLEvent";
import type { Attachment, MessageWithAttachments } from "../../Abstract/Attachment";
import { RawFilesAttachment } from "../../Mail/Store/RawFilesAttachment";
import { getFilesDir } from "../../util/backend-wrapper";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";

/** Save calendar event attachments as files in the local disk filesystem.
 * Same as the email attachments, just in a different directory,
 * sorted by the organizer of the meeting. */
export class RawFilesEventAttachment extends RawFilesAttachment {
  async saveAttachment(attachment: Attachment) {
    let event = attachment.message as Event;
    if (!attachment.content || attachment.filepathLocal || !event.dbID) {
      return;
    }
    attachment.filepathLocal = await this.writeFile(attachment, event);
    // The OS opens the file by its name on disk, which `sanitize.filename()` changed
    await attachment.checkExecutable();
    // Save the local file path in the calendar DB
    await SQLEvent.saveAttachmentFilename(event, attachment);
  }

  async getDirPath(message: MessageWithAttachments): Promise<string> {
    let event = message as Event;
    let filesDir = await getFilesDir();
    let organizer = sanitize.filename(event.organizer?.emailAddress?.replace("@", "-").substring(0, 30), "unknownPerson");
    let title = sanitize.filename(event.title?.substring(0, 30), "unknownEvent");
    return `${filesDir}/files/calendar/${organizer}/${event.dbID}-${title}`;
  }

  /** Remove all attachment files of this event from disk */
  async deleteEvent(event: Event): Promise<void> {
    await RawFilesEventAttachment.rmdirWithFiles(await this.getDirPath(event));
  }
}
