import { EMail } from "../EMail";
import type { Tag } from "../../Abstract/Tag";

export abstract class ExchangeEMail extends EMail {
  async markReplied() {
    await super.markReplied();
    await this.setFlagOnServer(EMailFlag.ReplyToSender, IconIndex.Replied);
  }

  async markForwarded() {
    await super.markForwarded();
    await this.setFlagOnServer(EMailFlag.Forward, IconIndex.Forwarded);
  }

  /** Exchange has no replied and forwarded flags, only the MAPI properties
   * that make Outlook show the reply and forward arrows. */
  protected abstract setFlagOnServer(verb: EMailFlag, icon: IconIndex): Promise<void>;

  async addTagOnServer(tag: Tag) {
    await this.updateTags();
  }

  async removeTagOnServer(tag: Tag) {
    await this.updateTags();
  }

  abstract updateTags(): Promise<void>;
}

// <https://learn.microsoft.com/en-us/openspecs/exchange_server_protocols/ms-oxprops/77844470-22ca-43fb-993d-c53e96cf9cd6>
export const MessageFlagsPidTag = "0x0E07";
// <https://learn.microsoft.com/en-us/openspecs/exchange_server_protocols/ms-oxprops/eeca3a02-14e7-419b-8918-986275a2fac0>
export const IconIndexPidTag = "0x1080";
// <https://learn.microsoft.com/en-us/openspecs/exchange_server_protocols/ms-oxprops/4ec55eac-14b3-4dfa-adf3-340c0dcccd44>
export const EMailFlagPidTag = "0x1081";
// <https://learn.microsoft.com/en-us/office/client-developer/outlook/mapi/pidtaglastverbexecutiontime-canonical-property>
export const EMailFlagTimePidTag = "0x1082";
/** 2 = the user flagged the message. There is no `FieldURI` for it.
 * <https://learn.microsoft.com/en-us/office/client-developer/outlook/mapi/pidtagflagstatus-canonical-property> */
export const FlagStatusPidTag = "0x1090";

/** Values of `IconIndexPidTag`.
 * Outlook shows the reply and forward arrows based on it.
 * <https://learn.microsoft.com/en-us/office/client-developer/outlook/mapi/pidtagiconindex-canonical-property> */
export enum IconIndex {
  Replied = 0x105,
  Forwarded = 0x106,
}

/** Values of `LastVerbPidTag`. ActiveSync reports them as `LastVerbExecuted` 1, 2 and 3.
 * <https://learn.microsoft.com/en-us/openspecs/exchange_server_protocols/ms-oxomsg/87a8b6b8-59a4-4859-9dcd-8b0f36e3d729> */
export enum EMailFlag {
  ReplyToSender = 102,
  ReplyToAll = 103,
  Forward = 104,
}
