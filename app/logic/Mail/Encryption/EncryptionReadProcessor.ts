import { EMailProcessor } from "../EMailProcessor";
import type { EMail } from "../EMail";
import PostalMIME from "postal-mime";

export abstract class EncryptionReadProcessor extends EMailProcessor {
  /** The outer headers aren't signed. If the signed part has its own
   * `From:`, the signature counts only if it's the same as the outer one.
   * @param signedMIME the signed part of a `multipart/signed`, which the reader doesn't parse otherwise */
  protected async signedFromMatches(email: EMail, signedMIME: Uint8Array): Promise<boolean> {
    let mime = new TextDecoder().decode(signedMIME);
    let headerEnd = mime.indexOf("\r\n\r\n");
    let signedFrom = (await new PostalMIME().parse(headerEnd < 0 ? mime : mime.slice(0, headerEnd))).from;
    return !signedFrom || signedFrom.address?.toLowerCase() == email.from.emailAddress.toLowerCase();
  }
}
