/** A rule in the copy of the rules that classic Outlook keeps */
export interface OutlookTestRule {
  name: string;
  isEnabled?: boolean;
  isForSentMail?: boolean;
}

/** Writes the copy of the rules that classic Outlook keeps, as Outlook 2016 and later write it,
 * see <https://docs.grommunio.com/dev/gromox/outlook_rule_spec/> and the tests of
 * <https://github.com/hughbe/OutlookRulesReader>. */
export function outlookRulesStream(rules: OutlookTestRule[]): Uint8Array {
  let stream = new ByteWriter();
  stream.uint32(0x00140000, 0x06140000, 0, 0, 0, 0, 0, 0, 1, 1, 0);
  stream.uint16(rules.length);
  for (let [i, rule] of rules.entries()) {
    // The rules in the hidden message have a 6 in the last byte, the exported rules a 0
    stream.uint32(i % 2 ? 0x06140000 : 0x00140000);
    if (rule.name.length < 0xFF) {
      stream.bytes.push(rule.name.length);
    } else {
      stream.bytes.push(0xFF);
      stream.uint16(rule.name.length);
    }
    stream.uint16(...rule.name.split("").map(char => char.charCodeAt(0)));
    stream.uint32(rule.isEnabled ?? true ? 1 : 0, 0, 0, 0, 0);
    let elements = new ByteWriter();
    elements.uint16(2);
    if (i == 0) {
      elements.uint16(0xFFFF, 0, 12);
      elements.bytes.push(..."CRuleElement".split("").map(char => char.charCodeAt(0)));
    } else {
      elements.uint16(0x8001);
    }
    elements.uint32(0x190, 1, 0, rule.isForSentMail ? 4 : 1);
    elements.uint16(0x8001);
    elements.uint32(0x64, 1, 0, 1);
    stream.uint32(elements.bytes.length);
    stream.bytes.push(...elements.bytes);
  }
  stream.uint32(0); // no template folder
  stream.uint32(2, 0, 0, 0); // no date, and unknown
  return new Uint8Array(stream.bytes);
}

class ByteWriter {
  readonly bytes: number[] = [];

  uint16(...values: number[]) {
    for (let value of values) {
      this.bytes.push(value & 0xFF, value >> 8 & 0xFF);
    }
  }

  uint32(...values: number[]) {
    for (let value of values) {
      this.bytes.push(value & 0xFF, value >> 8 & 0xFF, value >> 16 & 0xFF, value >>> 24);
    }
  }
}

export function base64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}
