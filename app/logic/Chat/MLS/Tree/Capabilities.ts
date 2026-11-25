/** What protocol features a client supports, RFC 9420 § 7.2.
 *
 *     struct {
 *         ProtocolVersion versions<V>;
 *         CipherSuite cipher_suites<V>;
 *         ExtensionType extensions<V>;
 *         ProposalType proposals<V>;
 *         CredentialType credentials<V>;
 *     } Capabilities;
 *
 * The `extensions` and `proposals` lists name only *non-default* types: the
 * seven proposal types and five extension types of the base protocol MUST NOT
 * be listed, so an empty list still means "supports all of the defaults". */
import { CipherSuite } from "../Crypto/CipherSuite";
import { CredentialType } from "../Messages/Credential";
import { ExtensionType } from "../Messages/Extension";
import { TLSReader } from "../Codec/TLSReader";
import { TLSWriter } from "../Codec/TLSWriter";

export class Capabilities {
  readonly versions: number[];
  readonly cipherSuites: number[];
  readonly extensions: number[];
  readonly proposals: number[];
  readonly credentials: number[];

  constructor(versions: number[], cipherSuites: number[], extensions: number[],
    proposals: number[], credentials: number[]) {
    this.versions = versions;
    this.cipherSuites = cipherSuites;
    this.extensions = extensions;
    this.proposals = proposals;
    this.credentials = credentials;
  }

  /** What this implementation supports: MLS 1.0, our cipher suites, the base
   * extensions and proposals, and both credential types. */
  static ours(credentials = [CredentialType.Basic, CredentialType.X509]): Capabilities {
    return new Capabilities([kProtocolVersionMLS10], CipherSuite.all.map(suite => suite.id), [], [], credentials);
  }

  static read(reader: TLSReader): Capabilities {
    let uint16 = (reader: TLSReader) => reader.uint16();
    return new Capabilities(reader.vector(uint16), reader.vector(uint16), reader.vector(uint16),
      reader.vector(uint16), reader.vector(uint16));
  }

  writeTo(writer: TLSWriter): void {
    let uint16 = (writer: TLSWriter, value: number) => writer.uint16(value);
    writer.vector(this.versions, uint16)
      .vector(this.cipherSuites, uint16)
      .vector(this.extensions, uint16)
      .vector(this.proposals, uint16)
      .vector(this.credentials, uint16);
  }

  supportsVersion(version: number): boolean {
    return this.versions.includes(version);
  }

  supportsCipherSuite(id: number): boolean {
    return this.cipherSuites.includes(id);
  }

  supportsExtension(type: number): boolean {
    return kDefaultExtensionTypes.includes(type) || this.extensions.includes(type);
  }

  supportsProposal(type: number): boolean {
    return type >= 0x0001 && type <= 0x0007 || this.proposals.includes(type);
  }

  supportsCredential(type: number): boolean {
    return this.credentials.includes(type);
  }
}

/** RFC 9420 § 6: the only protocol version defined */
export const kProtocolVersionMLS10 = 1;

/** RFC 9420 § 7.2: types that MUST NOT be listed, because every client has them */
const kDefaultExtensionTypes: number[] = [
  ExtensionType.ApplicationID, ExtensionType.RatchetTree, ExtensionType.RequiredCapabilities,
  ExtensionType.ExternalPub, ExtensionType.ExternalSenders,
];
