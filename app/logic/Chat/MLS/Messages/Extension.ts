/** An MLS extension, RFC 9420 § 7.2 and § 13.4.
 *
 *     struct {
 *         ExtensionType extension_type;
 *         opaque extension_data<V>;
 *     } Extension;
 *
 * Extensions appear in KeyPackages, LeafNodes, the GroupContext and GroupInfo.
 * We keep the raw `data` and let the concrete extension classes below parse it,
 * so that an unknown extension survives a parse/serialize round trip, which
 * matters because the GroupContext extensions are covered by signatures. */
import { Credential } from "./Credential";
import { TLSReader } from "../Codec/TLSReader";
import { TLSWriter, tlsSerialize } from "../Codec/TLSWriter";

export class Extension {
  readonly type: ExtensionType | number;
  readonly data: Uint8Array;

  constructor(type: ExtensionType | number, data: Uint8Array) {
    this.type = type;
    this.data = data;
  }

  static read(reader: TLSReader): Extension {
    return new Extension(reader.uint16(), reader.opaque());
  }

  static readVector(reader: TLSReader): Extension[] {
    return reader.vector(Extension.read);
  }

  static writeVector(writer: TLSWriter, extensions: readonly Extension[]): void {
    writer.vector(extensions, (writer, extension) => extension.writeTo(writer));
  }

  /** The one extension of this type, or null. Extension types are unique
   * within one list, RFC 9420 § 13.4. */
  static find(extensions: readonly Extension[], type: ExtensionType): Extension | null {
    return extensions.find(extension => extension.type == type) ?? null;
  }

  writeTo(writer: TLSWriter): void {
    writer.uint16(this.type).opaque(this.data);
  }
}

/** RFC 9420 § 17.3 "MLS Extension Types" */
export enum ExtensionType {
  ApplicationID = 0x0001,
  RatchetTree = 0x0002,
  RequiredCapabilities = 0x0003,
  ExternalPub = 0x0004,
  ExternalSenders = 0x0005,
}

/**
 * RFC 9420 § 11.1: what a group demands of every member.
 *
 *     struct {
 *         ExtensionType extension_types<V>;
 *         ProposalType proposal_types<V>;
 *         CredentialType credential_types<V>;
 *     } RequiredCapabilities;
 */
export class RequiredCapabilities {
  readonly extensionTypes: number[];
  readonly proposalTypes: number[];
  readonly credentialTypes: number[];

  constructor(extensionTypes: number[] = [], proposalTypes: number[] = [], credentialTypes: number[] = []) {
    this.extensionTypes = extensionTypes;
    this.proposalTypes = proposalTypes;
    this.credentialTypes = credentialTypes;
  }

  static fromExtension(extension: Extension): RequiredCapabilities {
    let reader = new TLSReader(extension.data);
    return new RequiredCapabilities(
      reader.vector(reader => reader.uint16()),
      reader.vector(reader => reader.uint16()),
      reader.vector(reader => reader.uint16()));
  }

  toExtension(): Extension {
    return new Extension(ExtensionType.RequiredCapabilities, tlsSerialize(writer => writer
      .vector(this.extensionTypes, (writer, type) => writer.uint16(type))
      .vector(this.proposalTypes, (writer, type) => writer.uint16(type))
      .vector(this.credentialTypes, (writer, type) => writer.uint16(type))));
  }
}

/**
 * RFC 9420 § 12.1.8.1: parties outside the group that may send proposals.
 * Wire puts its backend's removal key here, so that the server can remove
 * members that lost access.
 *
 *     struct {
 *         SignaturePublicKey signature_key;
 *         Credential credential;
 *     } ExternalSender;
 */
export class ExternalSender {
  readonly signatureKey: Uint8Array;
  readonly credential: Credential;

  constructor(signatureKey: Uint8Array, credential: Credential) {
    this.signatureKey = signatureKey;
    this.credential = credential;
  }

  static listFromExtension(extension: Extension): ExternalSender[] {
    return new TLSReader(extension.data).vector(reader =>
      new ExternalSender(reader.opaque(), Credential.read(reader)));
  }

  static listToExtension(senders: readonly ExternalSender[]): Extension {
    return new Extension(ExtensionType.ExternalSenders, tlsSerialize(writer =>
      writer.vector(senders, (writer, sender) => {
        writer.opaque(sender.signatureKey);
        sender.credential.writeTo(writer);
      })));
  }
}
