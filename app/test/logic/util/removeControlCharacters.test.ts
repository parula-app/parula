import { removeControlCharacters } from "../../../logic/util/util";
import { expect, test } from "vitest";

const kBidiControls = [
  "؜", // Arabic letter mark
  "‎", "‏", // LRM, RLM
  "‪", "‫", "‬", "‭", "‮", // LRE, RLE, PDF, LRO, RLO
  "⁦", "⁧", "⁨", "⁩", // LRI, RLI, FSI, PDI
];

function range(from: number, to: number): string[] {
  let chars: string[] = [];
  for (let code = from; code <= to; code++) {
    chars.push(String.fromCharCode(code));
  }
  return chars;
}

test("Emoji sequences and other visible text stay as they are", () => {
  for (let text of [
    "Family 👨‍👩‍👧", // ZWJ
    "🏳️‍🌈 ❤️ 1️⃣", // variation selector, ZWJ, keycap
    "👍🏽 🇩🇪 🏴󠁧󠁢󠁳󠁣󠁴󠁿", // skin tone, regional indicators, tag sequence
    "می‌خواهم", // ZWNJ
    "Grüße, 你好, שלום, مرحبا",
    "",
  ]) {
    expect(removeControlCharacters(text)).toBe(text);
  }
});

test("Bidi controls are removed, including isolates", () => {
  for (let control of kBidiControls) {
    let result = removeControlCharacters(`Open ${control}txt.exe${control} now`);
    expect(result).not.toContain(control);
    expect(result).toContain("Open");
    expect(result).toContain("txt.exe");
    expect(result).toContain("now");
  }
  let all = removeControlCharacters("a" + kBidiControls.join("") + "b");
  expect(kBidiControls.some(control => all.includes(control))).toBe(false);
});

test("C0 and C1 control characters are removed", () => {
  let controls = [...range(0x00, 0x1F), "\x7F", ...range(0x80, 0x9F)];
  for (let control of controls) {
    let result = removeControlCharacters(`one${control}two`);
    expect(result).not.toContain(control);
    expect(result).toContain("one");
    expect(result).toContain("two");
  }
  let all = removeControlCharacters("a" + controls.join("") + "b");
  expect(controls.some(control => all.includes(control))).toBe(false);
});

test("Emoji sequences survive next to removed controls", () => {
  let result = removeControlCharacters("‮👨‍👩‍👧\u0000❤️⁦");
  expect(result).toContain("👨‍👩‍👧");
  expect(result).toContain("❤️");
  expect(result).not.toMatch(/[‮\u0000⁦]/u);
});
