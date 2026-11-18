/** How a member asserts who it is, RFC 9420 § 5.3.
 *
 *     struct {
 *         CredentialType credential_type;
 *         select (Credential.credential_type) {
 *             case basic:
 *                 opaque identity<V>;
 *             case x509:
 *                 Certificate certificates<V>;
 *         };
 *     } Credential;
 *
 * A basic credential is a bare identity string whose format the application
 * defines; Wire uses `<userID>:<clientID>@<domain>`. An x509 credential carries
 * the DER certificate chain, end-entity first, and is what Wire's end-to-end
 * identity (E2EI) uses instead. */
import { TLSReader, TLSParseError } from "../Codec/TLSReader";
import { TLSWriter } from "../Codec/TLSWriter";
import { utf8 } from "../util";
import { bytesEqual } from "../../Signal/Crypto/primitives";

export abstract class Credential {
  abstract readonly type: CredentialType;

  static read(reader: TLSReader): Credential {
    let type = reader.uint16();
    switch (type) {
      case CredentialType.Basic:
        return new BasicCredential(reader.opaque());
      case CredentialType.X509:
        return new X509Credential(reader.vector(reader => reader.opaque()));
      default:
        throw new TLSParseError(`Unsupported MLS credential type ${type}`);
    }
  }

  abstract writeTo(writer: TLSWriter): void;

  /** Whether two members present the same identity, e.g. to spot a client
   * that is already in the group. */
  abstract equals(other: Credential): boolean;
}

export class BasicCredential extends Credential {
  readonly type = CredentialType.Basic;
  readonly identity: Uint8Array;

  constructor(identity: Uint8Array) {
    super();
    this.identity = identity;
  }

  static fromString(identity: string): BasicCredential {
    return new BasicCredential(utf8(identity));
  }

  get identityString(): string {
    return new TextDecoder().decode(this.identity);
  }

  writeTo(writer: TLSWriter): void {
    writer.uint16(this.type).opaque(this.identity);
  }

  equals(other: Credential): boolean {
    return other instanceof BasicCredential && this.identityString == other.identityString;
  }
}

export class X509Credential extends Credential {
  readonly type = CredentialType.X509;
  /** DER-encoded certificates, the end-entity certificate first */
  readonly certificates: Uint8Array[];

  constructor(certificates: Uint8Array[]) {
    super();
    this.certificates = certificates;
  }

  writeTo(writer: TLSWriter): void {
    writer.uint16(this.type).vector(this.certificates, (writer, certificate) => writer.opaque(certificate));
  }

  equals(other: Credential): boolean {
    return other instanceof X509Credential &&
      this.certificates.length == other.certificates.length &&
      this.certificates.every((cert, i) => bytesEqual(cert, other.certificates[i]));
  }
}

/** RFC 9420 § 17.5 "MLS Credential Types" */
export enum CredentialType {
  Basic = 0x0001,
  X509 = 0x0002,
}
