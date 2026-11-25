import { TopicLink, TopicLinkType } from "./TopicLink";
import { EMail } from "../../Mail/EMail";
import { findMessageByID } from "../../Mail/Store/setStorage";

/** `mid:` URL of RFC 2392, with the Message-ID. The same for all recipients. */
export class EMailLink extends TopicLink {
  readonly type = TopicLinkType.EMail;
  static readonly targetClass = EMail;
  protected readonly idProperty = "@id";
  protected readonly dateProperty = "dateSent";
  declare target: EMail | null;

  setTarget(email: EMail) {
    super.setTarget(email);
    this.targetID = email.messageID ? "mid:" + email.messageID : null;
    this.name = email.subject;
    this.date = email.sent;
  }

  async findTarget(): Promise<EMail | null> {
    this.target = await findMessageByID(this.targetID.substring("mid:".length)) ?? null;
    return this.target;
  }
}
