import { SendEncrypted } from "../SendEncrypted";
import type { EMail } from "../../EMail";
import { getMyPrivateKey, getPublicKeyForPersonUID } from "../KeyUtils";
import { CreateMIME } from "../../SMTP/CreateMIME";
import { SMIMEPublicKey } from "./SMIMEPublicKey";
import { SMIMEPrivateKey } from "./SMIMEPrivateKey";
import { Oid, UTCTime, Attributes, DigestInfo, SignedData, Certificate, RSAPublicKey, Null, OctetString, EnvelopedData, SMIMECapabilities } from "./SMIMEASN1";
import { decrypt, padFF, padRandom, encrypt } from "./SMIMERSAES";
import { splitMIMEHeaders, kLineBreak, newBoundary } from "../MIME";
import { assert } from "../../../util/util";
import { gt } from "../../../../l10n/l10n";

export class SMIMESend {
  /**
   * Called before sending email, if S/MIME is to be used.
   * Encrypts and signs the message, as requested.
   * The user must have a usable private key, otherwise mail throws.
   * If encryption is requested, all recipients must have usable public keys,
   * otherwise mail throws. The caller is responsible to ensure that.
   *
   * @returns a new email that is encrypted and/or signed.
   *   The original email is untouched.
   */
  static async encryptAndSign(mail: EMail, recipients = mail.allRecipients()): Promise<EMail> {
    let privateKey = getMyPrivateKey(mail.identity, SMIMEPrivateKey);
    assert(privateKey, gt`Please first set up S/MIME encryption for yourself, in Settings | Mail | Identity | Encryption`);
    assert(privateKey.certificate, gt`Your S/MIME key does not have a certificate yet. Please add it, in Settings | Mail | Identity | Encryption`);
    let rawKey = await privateKey.decryptKey();
    let result = SendEncrypted.cloneEMail(mail);
    let mime = await CreateMIME.getMIME(mail);
    let mimeAsText = new TextDecoder().decode(mime);
    if (mail.signedByKeyID) {
      // Only the body and the Content-* headers are signed, not the other headers.
      let { content, otherHeaders } = await SMIMESend.splitOffContent(mimeAsText);
      mimeAsText = content;
      let messageDigest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(mimeAsText)));
      // DER SET OF requires the elements sorted by their encoding (X.690
      // section 11.6). With these fixed value sizes, that is the order below:
      // the encodings differ first in their length byte.
      let signedAttributes = [{
        attrType: "contentType",
        attrValue: [Oid.encode("data")],
      }, {
        attrType: "signingTime",
        // RFC 5652 section 11.3: MUST be UTCTime for dates through 2049
        attrValue: [UTCTime.encode(Date.now())],
      }, {
        attrType: "messageDigest",
        attrValue: [OctetString.encode(messageDigest)],
      }, {
        attrType: "smimeCapabilities",
        attrValue: [SMIMECapabilities.encode(kOurCapabilities)],
      }];
      let encodedAttrs = Attributes.encode(signedAttributes);
      let attributesDigest = new Uint8Array(await crypto.subtle.digest("SHA-256", encodedAttrs));
      let digestInfo = {
        digestAlgorithm: {
          algorithm: "sha256",
          parameters: Null.encode(),
        },
        digest: attributesDigest,
      };
      let signature = decrypt(padFF(DigestInfo.encode(digestInfo), rawKey), rawKey);
      let myCertificate = Certificate.decodePEM(privateKey.certificate, { label: "CERTIFICATE" });
      let signerInfo = {
        version: 1n,
        sid: {
          type: "issuerAndSerialNumber",
          value: {
            issuer: myCertificate.tbsCertificate.issuer,
            serialNumber: myCertificate.tbsCertificate.serialNumber,
          },
        },
        digestAlgorithm: {
          algorithm: "sha256",
          parameters: Null.encode(),
        },
        signedAttrs: signedAttributes,
        signatureAlgorithm: {
          algorithm: "rsaEncryption",
          parameters: Null.encode(),
        },
        signature: signature,
      };
      let signedData = {
        contentType: "signedData",
        content: {
          version: 1n,
          digestAlgorithms: [{
            algorithm: "sha256",
            parameters: Null.encode(),
          }],
          contentInfo: {
            contentType: "data",
          },
          certificates: [myCertificate],
          signerInfos: [signerInfo],
        },
      };
      for (let cert of privateKey.chain) {
        signedData.content.certificates.push(Certificate.decodePEM(cert.certificate, { label: "CERTIFICATE" }));
      }
      let boundary = newBoundary();
      mimeAsText = [
        `Content-Type: multipart/signed; protocol="application/pkcs7-signature"; micalg=sha-256; boundary="${boundary}"`,
        ...otherHeaders,
        '',
        `--${boundary}`,
        mimeAsText,
        `--${boundary}`,
        'Content-Type: application/pkcs7-signature; name="smime.p7s"',
        'Content-Transfer-Encoding: base64',
        'Content-Disposition: attachment; filename="smime.p7s"',
        '',
        //...btoa(der.getBytes()).match(/.{1,76}/g),
        ... SignedData.encodeToBase64(signedData).match(/.{1,76}/g),
        `--${boundary}--`,
        '',
      ].join(kLineBreak);
    }
    if (mail.shouldEncrypt) {
      // Only the body and the Content-* headers are encrypted, not the other headers.
      let { content, otherHeaders } = await SMIMESend.splitOffContent(mimeAsText);
      mime = new TextEncoder().encode(content);
      let recipientKeys = recipients.contents.flatMap(puid =>
        getPublicKeyForPersonUID(puid, SMIMEPublicKey));
      if (!(await Promise.all(recipientKeys.map(key => key.matches(rawKey)))).some(Boolean)) {
        recipientKeys.push(privateKey);
      }
      let symmetricKey = new Uint8Array(32);
      let vector = new Uint8Array(16);
      crypto.getRandomValues(symmetricKey);
      crypto.getRandomValues(vector);
      let key = await crypto.subtle.importKey("raw", symmetricKey, "AES-CBC", false, ["encrypt"]);
      let pkcs7 = {
        contentType: "envelopedData",
        content: {
          version: 0n,
          recipientInfos: [],
          encryptedContentInfo: {
            contentType: "data",
            contentEncryptionAlgorithm: {
              algorithm: "aes256cbc",
              parameters: OctetString.encode(vector),
            },
            encryptedContent: new Uint8Array(await crypto.subtle.encrypt({ name: "AES-CBC", iv: vector }, key, mime)),
          }
        }
      };
      for (let recipientKey of recipientKeys) {
        let cert = Certificate.decodePEM(recipientKey.certificate, { label: "CERTIFICATE" });
        let rsa = RSAPublicKey.decode(cert.tbsCertificate.publicKey.subjectPublicKey.data);
        pkcs7.content.recipientInfos.push({
          type: "ktri",
          value: {
            version: 0n,
            rid: {
              type: "issuerAndSerialNumber",
              value: {
                issuer: cert.tbsCertificate.issuer,
                serialNumber: cert.tbsCertificate.serialNumber,
              }
            },
            keyEncryptionAlgorithm: {
              algorithm: "rsaEncryption",
              parameters: Null.encode(),
            },
            encryptedKey: encrypt(padRandom(symmetricKey, rsa), rsa),
          },
        });
      }
      let der = EnvelopedData.encode(pkcs7);
      let base64 = der.toBase64?.() ?? toBase64(der);
      mimeAsText = [
        'Content-Type: application/pkcs7-mime; smime-type=enveloped-data; name="smime.p7m"',
        'Content-Transfer-Encoding: base64',
        `Content-Disposition: attachment; filename="smime.p7m"`,
        ...otherHeaders,
        '',
        ...base64.match(/.{1,76}/g),
        '',
      ].join(kLineBreak);
    }
    result.sendRawMIME = mimeAsText;
    return result;
  }

  static async splitOffContent(mime: string): Promise<{ content: string, otherHeaders: string[] }> {
    let { headers, body } = await splitMIMEHeaders(mime);
    let contentHeaders = headers.filter(header => header.key.startsWith("content-")).map(header => header.line);
    let otherHeaders = headers.filter(header => !header.key.startsWith("content-")).map(header => header.line);
    if (!headers.some(header => header.key == "content-type")) {
      contentHeaders.unshift("Content-Type: text/plain");
    }
    return {
      content: [
        ...contentHeaders,
        "",
        body,
      ].join(kLineBreak),
      otherHeaders,
    };
  }
}

/** The algorithms that we can decrypt and verify. We tell our correspondents
 * about them, so that they write to us in a way that we actually support.
 * Without this, Outlook before build 16.0.8518 encrypts with 3DES.
 *
 * RFC 8551 section 2.5.2: best first, but grouped by category. The categories
 * themselves are in the order in which they matter to the correspondent: which
 * cipher to encrypt the mail with is the decision that we most need to steer.
 * We deliberately do not offer SHA-1, even though we still verify it, and we
 * do not list the `parameters` of any of them, which the RFC allows only where
 * 2 instances of the same algorithm would otherwise be indistinguishable. */
export const kOurCapabilities = [
  // Authenticating symmetric ciphers
  { capabilityID: "aes256gcm" },
  { capabilityID: "aes192gcm" },
  { capabilityID: "aes128gcm" },
  // Symmetric ciphers
  { capabilityID: "aes256cbc" },
  { capabilityID: "aes192cbc" },
  { capabilityID: "aes128cbc" },
  // Signature algorithms
  { capabilityID: "sha512WithRSAEncryption" },
  { capabilityID: "sha384WithRSAEncryption" },
  { capabilityID: "sha256WithRSAEncryption" },
  // Digest algorithms
  { capabilityID: "sha512" },
  { capabilityID: "sha384" },
  { capabilityID: "sha256" },
  // Key encipherment. We support only RSAES-PKCS1-v1_5, not RSAES-OAEP.
  { capabilityID: "rsaEncryption" },
];

function toBase64(buf: Uint8Array): string {
  // Chunk, because spreading a large array (enveloped mail with attachments can
  // be several MB) into String.fromCharCode overflows the call stack.
  let str = "";
  for (let i = 0; i < buf.length; i += 0x8000) {
    str += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  }
  return btoa(str);
}

declare global {
  interface Uint8Array {
    toBase64(options?: { alphabet?: "base64" | "base64url", omitPadding?: boolean } ): string;
  }
}
