import type { FilterRuleAction } from "../FilterRules/FilterRuleAction";
import { NotSupported } from "../../util/util";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";
import { ArrayColl } from "svelte-collections";

/** The copy of all rules that classic Outlook keeps in a hidden message in the Inbox.
 * Exchange deletes it when another client changes the server rules,
 * and Outlook makes a new copy from the server rules.
 *
 * Microsoft does not document the format. We read only the name, the state and
 * the moment of each rule, see <https://docs.grommunio.com/dev/gromox/outlook_rule_spec/>. */
export class OutlookRulesCopy {
  readonly rules = new ArrayColl<OutlookRule>();

  static readonly kItemClass = "IPM.RuleOrganizer";
  /** `PR_RW_RULES_STREAM` */
  static readonly kPropertyTag = "0x6802";

  /** @param stream The property `kPropertyTag` of the hidden message.
   * Throws, if the format is not as we know it. */
  constructor(stream: Uint8Array) {
    // Outlook 2016 and later, 2007, 2003, 2002
    const kFormats = [0x140000, 1200000, 1100000, 1000000];
    let reader = new LittleEndianReader(stream);
    let format = reader.uint32();
    if (!kFormats.includes(format)) {
      throw new NotSupported(`Outlook's copy of the rules has the unknown format ${format}`);
    }
    reader.skip(4);
    let header = [reader.uint32(), reader.uint32(), reader.uint32(), reader.uint32(), reader.uint32(), reader.uint32(), reader.uint32(), reader.uint32(), reader.uint32()];
    if (header[0] != 0 || header[1] != 0 || header[2] != 0 || header[7] != 1) {
      throw new NotSupported("Outlook's copy of the rules has an unknown header");
    }
    let count = reader.uint16();
    for (let i = 0; i < count; i++) {
      this.rules.add(this.readRule(reader, kFormats));
    }
    let templateFolderLength = reader.uint32();
    if (reader.remaining != templateFolderLength * 2 + 16) {
      throw new NotSupported("Outlook's copy of the rules does not end as expected");
    }
  }

  protected readRule(reader: LittleEndianReader, formats: number[]): OutlookRule {
    const kMomentElement = 0x190;
    if (!formats.includes(reader.uint32() & 0xFFFFFF)) {
      throw new NotSupported("A rule in Outlook's copy of the rules has an unknown format");
    }
    let name = reader.utf16(reader.length());
    let isEnabled = reader.uint32() != 0;
    reader.skip(16);
    let size = reader.uint32();
    let end = reader.position + size;
    reader.skip(2);
    let separator = reader.uint16();
    if (separator == 0xFFFF) {
      reader.skip(2);
      if (reader.ascii(reader.uint16()) != "CRuleElement") {
        throw new NotSupported("A rule in Outlook's copy of the rules has an unknown class");
      }
    } else if (separator != 0x8001) {
      throw new NotSupported("A rule in Outlook's copy of the rules has an unknown separator");
    }
    if (reader.uint32() != kMomentElement || reader.uint32() != 1) {
      throw new NotSupported("A rule in Outlook's copy of the rules does not start with the moment when it runs");
    }
    reader.skip(4);
    let moments = reader.uint32();
    if (reader.position > end) {
      throw new NotSupported("A rule in Outlook's copy of the rules is longer than its size");
    }
    reader.seek(end);
    return new OutlookRule(sanitize.nonemptylabel(name, "-"), isEnabled, moments);
  }

  /** The rules that exist only in this copy. They would be lost, if Exchange deleted it:
   * The server has no rules for sent mail, and not all rules that are turned off in Outlook.
   * @param serverRules All rules on the server */
  lostRules(serverRules: FilterRuleAction[]): ArrayColl<OutlookRule> {
    let serverNames = serverRules.map(rule => rule.name);
    let lost = new ArrayColl<OutlookRule>();
    for (let rule of this.rules) {
      let index = rule.isForSentMail ? -1 : serverNames.indexOf(rule.name);
      if (index < 0) {
        lost.add(rule);
        continue;
      }
      serverNames.splice(index, 1);
    }
    return lost;
  }
}

export class OutlookRule {
  readonly name: string;
  readonly isEnabled: boolean;
  /** Outlook runs it on the mails that the user sends */
  readonly isForSentMail: boolean;

  /** @param moments Bit field: 1 = after the mail arrives, 4 = after the user sent it */
  constructor(name: string, isEnabled: boolean, moments: number) {
    this.name = name;
    this.isEnabled = isEnabled;
    this.isForSentMail = (moments & 4) != 0;
  }
}

class LittleEndianReader {
  readonly bytes: Uint8Array;
  protected readonly view: DataView;
  position = 0;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  get remaining(): number {
    return this.bytes.length - this.position;
  }

  uint8(): number {
    let value = this.view.getUint8(this.position);
    this.position += 1;
    return value;
  }

  uint16(): number {
    let value = this.view.getUint16(this.position, true);
    this.position += 2;
    return value;
  }

  uint32(): number {
    let value = this.view.getUint32(this.position, true);
    this.position += 4;
    return value;
  }

  /** A length in 1 byte, or in the 2 bytes after it, if the first byte is 0xFF */
  length(): number {
    let length = this.uint8();
    return length == 0xFF ? this.uint16() : length;
  }

  utf16(length: number): string {
    return new TextDecoder("utf-16le").decode(this.take(length * 2));
  }

  ascii(length: number): string {
    return String.fromCharCode(...this.take(length));
  }

  skip(count: number) {
    this.take(count);
  }

  seek(position: number) {
    if (position > this.bytes.length) {
      throw new RangeError("Beyond the end of the data");
    }
    this.position = position;
  }

  protected take(count: number): Uint8Array {
    if (count > this.remaining) {
      throw new RangeError("Beyond the end of the data");
    }
    let bytes = this.bytes.subarray(this.position, this.position + count);
    this.position += count;
    return bytes;
  }
}
