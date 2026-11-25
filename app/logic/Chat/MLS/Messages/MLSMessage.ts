/** The outermost MLS object, RFC 9420 § 6.
 *
 *     struct {
 *         ProtocolVersion version = mls10;
 *         WireFormat wire_format;
 *         select (MLSMessage.wire_format) {
 *             case mls_public_message:  PublicMessage public_message;
 *             case mls_private_message: PrivateMessage private_message;
 *             case mls_welcome:         Welcome welcome;
 *             case mls_group_info:      GroupInfo group_info;
 *             case mls_key_package:     KeyPackage key_package;
 *         };
 *     } MLSMessage;
 *
 * Everything that crosses the wire is wrapped in this, under media type
 * `message/mls`: four bytes of header, then the body. The wire format is not
 * stored separately — it follows from what the body is, and it is part of the
 * `FramedContentTBS` signature, so a message cannot be re-framed. */
import { GroupInfo } from "./GroupInfo";
import { KeyPackage } from "./KeyPackage";
import { PrivateMessage, PublicMessage, WireFormat } from "./Framing";
import { Welcome } from "./Welcome";
import { TLSReader, TLSParseError, tlsParse } from "../Codec/TLSReader";
import { TLSWriter, tlsSerialize } from "../Codec/TLSWriter";
import { kProtocolVersionMLS10 } from "../Tree/Capabilities";

export class MLSMessage {
  readonly version: number;
  readonly body: MLSMessageBody;

  constructor(body: MLSMessageBody, version = kProtocolVersionMLS10) {
    this.body = body;
    this.version = version;
  }

  get wireFormat(): WireFormat {
    if (this.body instanceof PublicMessage) {
      return WireFormat.PublicMessage;
    } else if (this.body instanceof PrivateMessage) {
      return WireFormat.PrivateMessage;
    } else if (this.body instanceof Welcome) {
      return WireFormat.Welcome;
    } else if (this.body instanceof GroupInfo) {
      return WireFormat.GroupInfo;
    }
    return WireFormat.KeyPackage;
  }

  static read(reader: TLSReader): MLSMessage {
    let version = reader.uint16();
    let wireFormat = reader.uint16();
    switch (wireFormat) {
      case WireFormat.PublicMessage:
        return new MLSMessage(PublicMessage.read(reader), version);
      case WireFormat.PrivateMessage:
        return new MLSMessage(PrivateMessage.read(reader), version);
      case WireFormat.Welcome:
        return new MLSMessage(Welcome.read(reader), version);
      case WireFormat.GroupInfo:
        return new MLSMessage(GroupInfo.read(reader), version);
      case WireFormat.KeyPackage:
        return new MLSMessage(KeyPackage.read(reader), version);
      default:
        throw new TLSParseError(`Unknown MLS wire format ${wireFormat}`);
    }
  }

  static fromBytes(data: Uint8Array): MLSMessage {
    return tlsParse(data, MLSMessage.read);
  }

  writeTo(writer: TLSWriter): void {
    writer.uint16(this.version).uint16(this.wireFormat);
    this.body.writeTo(writer);
  }

  toBytes(): Uint8Array {
    return tlsSerialize(writer => this.writeTo(writer));
  }

  get publicMessage(): PublicMessage | null {
    return this.body instanceof PublicMessage ? this.body : null;
  }

  get privateMessage(): PrivateMessage | null {
    return this.body instanceof PrivateMessage ? this.body : null;
  }

  get welcome(): Welcome | null {
    return this.body instanceof Welcome ? this.body : null;
  }

  get groupInfo(): GroupInfo | null {
    return this.body instanceof GroupInfo ? this.body : null;
  }

  /** RFC 9420 § 10: a KeyPackage inside an MLSMessage must agree with the
   * wrapper about the protocol version. */
  get keyPackage(): KeyPackage | null {
    if (!(this.body instanceof KeyPackage)) {
      return null;
    }
    if (this.body.version != this.version) {
      throw new TLSParseError(`KeyPackage version ${this.body.version} does not match MLSMessage ${this.version}`);
    }
    return this.body;
  }
}

export type MLSMessageBody = PublicMessage | PrivateMessage | Welcome | GroupInfo | KeyPackage;
