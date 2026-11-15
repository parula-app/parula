/**
 * Writes the Klingon translation in the pIqaD script, `locales/tlh-Piqd/`,
 * from the Klingon translation in the Latin script, `locales/tlh/`.
 * Run `yarn run l10n:pIqaD` after the Latin translation changed.
 *
 * pIqaD is in the Private Use Area, as the ConScript Unicode Registry defines it.
 * The app shows it with the font Constr-Klingon, see `app.css`.
 */
import { readFile, writeFile } from "fs/promises";

function isKlingonWord(word: string): boolean {
  /** Klingon syllables are a consonant, a vowel, and optionally 1 consonant, or w', y' or rgh */
  const kWord = /^((tlh|ch|gh|ng|[bDHjlmnpqQrStvwy'])[aeIou](w'|y'|rgh|tlh|ch|gh|ng|[bDHjlmnpqQrStvwy'])?)+$/;
  /** English words in the Klingon translation that are spelled like Klingon words */
  const kEnglish = ["Del", "bar", "menu", "tab", "tel", "to", "web"];
  return kWord.test(word) && !kEnglish.includes(word);
}

/** @param word must be a Klingon word */
function wordToPIqaD(word: string): string {
  /** The pIqaD letters are U+F8D0 to U+F8E9, in this order */
  const kAlphabet = ["a", "b", "ch", "D", "e", "gh", "H", "I", "j", "l", "m", "n", "ng", "o", "p", "q", "Q", "r", "S", "t", "tlh", "u", "v", "w", "y", "'"];
  let pIqaD = "";
  for (let i = 0; i < word.length;) {
    // "ngh" is n + gh
    let letter = ["tlh", "ch", "gh", "ng", word[i]].find(l => word.startsWith(l, i) && !(l == "ng" && word[i + 2] == "h"));
    pIqaD += String.fromCharCode(0xF8D0 + kAlphabet.indexOf(letter));
    i += letter.length;
  }
  return pIqaD;
}

/** Klingon suffixes that the translation adds to English words, e.g. accountmeylIj */
function isSuffixes(text: string): boolean {
  const kSuffixes = ["pu'", "Du'", "mey", "qoq", "Hey", "na'", "wIj", "wI'", "maj", "ma'", "lIj", "lI'", "raj", "ra'", "Daj", "chaj", "vam", "vetlh", "Daq", "vo'", "mo'", "vaD", "'e'", "Ha'"];
  while (text) {
    let suffix = kSuffixes.find(s => text.startsWith(s));
    if (!suffix) {
      return false;
    }
    text = text.slice(suffix.length);
  }
  return true;
}

/**
 * English words and names stay in Latin, like in the Latin translation.
 * With Klingon affixes, only the affixes are in pIqaD, e.g. yItag, accountDaq.
 * @returns pIqaD, or `word` unchanged, if it's not Klingon
 */
function tokenToPIqaD(word: string): string {
  /** Misspellings in the Latin translation. pIqaD has no letter case
   * and can't write them, e.g. a lowercase h, which only exists in ch, gh and tlh. */
  const kCorrections = {
    "'anghta'be'qa'": "'angta'be'qa'",
    "DaChIlchugh": "DachIlchugh",
    "Dabuvlah": "DabuvlaH",
    "Dachelmeh": "DachelmeH",
    "Dachenmoh": "DachenmoH",
    "Dachenmohmeh": "DachenmoHmeH",
    "Daghajnis": "DaghajnIS",
    "Dalaadbe'": "DalaDbe'",
    "Dalaadlah": "DalaDlaH",
    "Damuvmoh": "DamuvmoH",
    "DamuvmohlaH": "DamuvmoHlaH",
    "DanItlhmohlaH": "DanItlhmoHlaH",
    "Dangehpu'": "DangeHpu'",
    "Danudchugh": "DanuDchugh",
    "DapongqA'laHbe'": "Dapongqa'laHbe'",
    "Dateqmeh": "DateqmeH",
    "Davellah": "DavellaH",
    "Davelmeh": "DavelmeH",
    "Davergmeh": "DaverghmeH",
    "Davoqnis": "DavoqnIS",
    "Hevmeh": "HevmeH",
    "Hochvad": "HochvaD",
    "Nextcloudvad": "NextcloudvaD",
    "Sammeh": "SammeH",
    "SibI'": "SIbI'",
    "Vergh": "vergh",
    "chenmohmeH": "chenmoHmeH",
    "ghItlmey": "ghItlhmey",
    "nobpu'nis": "nobpu'nIS",
    "nud": "nuD",
    "nudlu'be'": "nuDlu'be'",
    "nudlu'meH": "nuDlu'meH",
    "nudlu'vo'": "nuDlu'vo'",
    "nudmeH": "nuDmeH",
    "nudtaH": "nuDtaH",
    "nudwI'Daq": "nuDwI'Daq",
    "yIchILmoH": "yIchIlmoH",
    "yIchILqa'moH": "yIchIlqa'moH",
    "yInud": "yInuD",
    "yInudQo'": "yInuDQo'",
  };
  word = kCorrections[word] ?? word;
  if (isKlingonWord(word)) {
    return wordToPIqaD(word);
  }
  let prefix = word.startsWith("yI") ? "yI" : "";
  for (let i = prefix.length + 1; i < word.length; i++) {
    if (isSuffixes(word.slice(i)) && !isKlingonWord(word.slice(prefix.length, i))) {
      return (prefix && wordToPIqaD(prefix)) + word.slice(prefix.length, i) + wordToPIqaD(word.slice(i));
    }
  }
  return prefix ? wordToPIqaD(prefix) + word.slice(prefix.length) : word;
}

function isPIqaD(char: string): boolean {
  return char >= "\uF8D0" && char <= "\uF8E9";
}

/** Plain text, without placeholders and HTML */
function textToPIqaD(text: string): string {
  // The catalog has newlines as \n
  return text.split(/(\s+|\\n)/).map((chunk, i) => {
    // URLs, email addresses and file names stay as they are
    if (i % 2 || chunk.includes("://") || chunk.includes("@") || /\w\.\w/.test(chunk)) {
      return chunk;
    }
    chunk = chunk.replace(/[A-Za-z']+/g, tokenToPIqaD);
    // Klingon comma and full stop at the end of a word, but not in numbers like 1.5 or in "..."
    let last = chunk.at(-1);
    let before = chunk.at(-2) ?? "";
    if ((last == "." || last == ",") && !(before >= "0" && before <= "9") && before != "." && before != ",") {
      chunk = chunk.slice(0, -1) + (last == "." ? "\uF8FE" : "\uF8FD");
    }
    return chunk;
  }).join("");
}

/** Text with HTML tags */
function htmlToPIqaD(html: string): string {
  // The button labels of other apps stay in English
  return html.split(/(<span class="mock-button">.*?<\/span>|<[^>]*>)/s)
    .map((part, i) => i % 2 ? part : textToPIqaD(part))
    .join("");
}

/** Transliterates the text of an ICU message, but not its placeholders and plural syntax */
function messageToPIqaD(message: string): string {
  let pos = 0;
  /** Text and placeholders, until the end of the message or of a plural option */
  function parseText(isOption: boolean): string {
    let result = "";
    let text = "";
    while (pos < message.length && !(isOption && message[pos] == "}")) {
      if (message[pos] == "{") {
        result += htmlToPIqaD(text) + parsePlaceholder();
        text = "";
      } else {
        text += message[pos++];
      }
    }
    return result + htmlToPIqaD(text);
  }
  /** {0} or {0, plural, one {text} other {text}} */
  function parsePlaceholder(): string {
    let result = message[pos++];
    while (pos < message.length && message[pos] != "}") {
      if (message[pos] == "{") {
        pos++;
        result += "{" + parseText(true) + "}";
        pos++;
      } else {
        result += message[pos++];
      }
    }
    pos++;
    return result + "}";
  }
  let pIqaD = parseText(false);
  // Messages with only English words and names stay as they are, also their punctuation
  return [...pIqaD].some(isPIqaD) ? pIqaD : message;
}

const tlh: Record<string, string> = JSON.parse(await readFile(new URL("./locales/tlh/messages.json", import.meta.url), "utf8"));
const pIqaD: Record<string, string> = {};
for (let id in tlh) {
  pIqaD[id] = messageToPIqaD(tlh[id]);
}
await writeFile(new URL("./locales/tlh-Piqd/messages.json", import.meta.url), JSON.stringify(pIqaD, null, 2) + "\n");
