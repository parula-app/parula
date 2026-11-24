import type { EMail } from "../EMail";
import type { PersonUID } from "../../Abstract/PersonUID";
import { Attachment , ContentDisposition } from "../../Abstract/Attachment";
import { getICal } from "../../Calendar/ICal/ICalGenerator";
import { appGlobal } from "../../app";
import { getUserPreference } from "../../util/util";
import { fixNewlines } from "../../util/convertHTML";
import { uint8ArrayToBase64 } from "../../util/blob";
import type { ArrayColl } from "svelte-collections";
import type { default as Mail, Attachment as NMAttachment, Address as NMAddress } from "nodemailer/lib/mailer";
type NMMail = Mail.Options;

export class CreateMIME {
  static async getMIME(email: EMail): Promise<Uint8Array> {
    let mail = await CreateMIME.getNMMail(email);
    return await appGlobal.remoteApp.getMIMENodemailer(mail);
  }

  static async getNMMail(email: EMail): Promise<NMMail> {
    if (email.sendRawMIME) { // Encrypted emails
      let smtpRecipients = email.allRecipients();
      smtpRecipients.addAll(email.bcc);
      return {
        envelope: {
          from: email.from.emailAddress,
          to: smtpRecipients.contents.map(p => p.emailAddress),
        },
        raw: email.sendRawMIME,
      };
    }
    let doHTML = getUserPreference("mail.send.format", "html") == "html";
    let iCal = email.event ? await getICal(email.event, email.iCalMethod) : null;
    // <https://nodemailer.com/message/>
    return {
      messageId: email.messageID ?? undefined,
      subject: email.subject,
      inReplyTo: email.inReplyTo,
      from: CreateMIME.getRecipient(email.from),
      replyTo: email.replyTo ? CreateMIME.getRecipient(email.replyTo) : null,
      references: email.references,
      to: CreateMIME.getRecipients(email.to),
      cc: CreateMIME.getRecipients(email.cc),
      bcc: CreateMIME.getRecipients(email.bcc),
      text: email.text ? CreateMIME.getFlowedText(email.text) : undefined,
      html: doHTML ? fixNewlines(email.html) : null,
      icalEvent: iCal ? {
        content: iCal,
        method: email.iCalMethod,
      } : undefined,
      attachDataUrls: true,
      attachments: await CreateMIME.getAttachments(email),
      headers: email.headers.contentKeyValues(),
      disableFileAccess: true,
      disableUrlAccess: true,
    };
  }

  /** As format=flowed (RFC 3676), which `FormatFlowedWriter` wrote, and nodemailer can't declare */
  protected static getFlowedText(text: string): NMAttachment {
    text = fixNewlines(text);
    let bytes = new TextEncoder().encode(text);
    // Base64 keeps the spaces at the end of the lines. The RFC prefers no encoding.
    let isASCII = bytes.length == text.length;
    return {
      raw: [
        "Content-Type: text/plain; charset=utf-8; format=flowed",
        "Content-Transfer-Encoding: " + (isASCII ? "7bit" : "base64"),
        "",
        isASCII ? text : uint8ArrayToBase64(bytes).match(/.{1,76}/g).join("\r\n"),
      ].join("\r\n"),
    };
  }

  protected static getRecipients(recipients: ArrayColl<PersonUID>): NMAddress[] {
    return recipients.contents.map(to => CreateMIME.getRecipient(to));
  }
  protected static getRecipient(to: PersonUID): NMAddress {
    // `${to.name} <${to.emailAddress}>` created by nodemailer, with quotes
    return {
      name: to.name,
      address: to.emailAddress,
    };
  }
  protected static async getAttachments(email: EMail): Promise<NMAttachment[]> {
    await CreateMIME.addSML(email);
    return await Promise.all(email.attachments.contents.map((a) => CreateMIME.getAttachment(a)));
  }
  protected static async getAttachment(a: Attachment): Promise<NMAttachment> {
    return {
      filename: a.filename,
      content: await a.contentAsBase64(),
      encoding: "base64",
      contentType: a.mimeType,
      contentDisposition: a.disposition == ContentDisposition.inline ? 'inline' : 'attachment',
      cid: a.contentID,
    };
  }
  protected static async addSML(email: EMail): Promise<void> {
    if (!email.sml) {
      return;
    }
    if (email.sml.sml?.reactions) { // TODO Allow SML usecase to prepare the SML on send
      email.sml.sml.reactions = [];
    }
    let att = email.attachments.find(att => att.mimeType == "application/ld+json");
    if (!att) {
      att = email.newAttachment();
      att.filename = "SML.json";
      att.mimeType = "application/ld+json";
      att.disposition = ContentDisposition.inline;
      att.contentID = "sml"; // triggers multipart/related in nodemailer, required by <https://www.ietf.org/archive/id/draft-ietf-sml-structured-email-05.html#name-partial-representation>
      email.attachments.add(att);
    }
    att.content = new File([JSON.stringify(email.sml.sml, null, 2)], att.filename, { type: att.mimeType });
    att.size = att.content.size;
  }
}
