import { sanitize } from '../../../../lib/util/sanitizeDatatypes';
import { expect, test } from 'vitest';

test("Check Latin email addresses", () => {
  sanitize.emailAddress("dh@example.com");
  sanitize.emailAddress("dh@example.im");
  sanitize.emailAddress("dh@example.mobile");
  sanitize.emailAddress("dh@example.im");
  sanitize.emailAddress("dh@ex-ample.im");
  sanitize.emailAddress("dh+g@example.im");
  sanitize.emailAddress("dh.g@example.im");
  sanitize.emailAddress("dh-g@example.im");
  // DMARC rewriting on mailing lists, SRS, VERP
  sanitize.emailAddress("foo=40example.com@dmarc.ietf.org");
  sanitize.emailAddress("srs0=hhh=t4=example.com=foo@forwarder.example.net");
  sanitize.emailAddress("o'brien@example.com");
  expect(sanitize.emailAddress(" dh@example.com ")).toBe("dh@example.com");
  expect(() => {
    sanitize.emailAddress("d@com");
  }).toThrow();
  expect(() => {
    sanitize.emailAddress("d@example.c-om");
  }).toThrow();
  expect(() => {
    sanitize.emailAddress("d@example.-com");
  }).toThrow();
  expect(() => {
    sanitize.emailAddress("d@example.com-");
  }).toThrow();
  // RFC 5322 atext specials, deliberately rejected as defense in depth
  expect(() => {
    sanitize.emailAddress("d#h@example.com");
  }).toThrow();
  expect(() => {
    sanitize.emailAddress("d&h@example.com");
  }).toThrow();
  expect(() => {
    sanitize.emailAddress("d h@example.com");
  }).toThrow();
  expect(() => {
    sanitize.emailAddress("d%20h@example.com");
  }).toThrow();
  expect(() => {
    sanitize.emailAddress("d\\h@example.com");
  }).toThrow();
  expect(() => {
    sanitize.emailAddress("d\nh@example.com");
  }).toThrow();
  expect(() => {
    sanitize.emailAddress("d\rh@example.com");
  }).toThrow();
  expect(() => {
    sanitize.emailAddress("d\th@example.com");
  }).toThrow();
  expect(() => {
    sanitize.emailAddress("d`h@example.com");
  }).toThrow();
});

test("Check EAI email addresses", () => {
  sanitize.emailAddress("ндрис@уайлддк.орг");
  sanitize.emailAddress("ндрис@уайлддк.xn--4dn5");
  sanitize.emailAddress("ндрис@уайлддк.XN--4DN5");
  sanitize.emailAddress("нд1²³рис@уай1²³лддк.орг");
  sanitize.emailAddress("äüößéáúàèù@äüößéáúàèù.com");
  // Chinese
  sanitize.emailAddress("用户@例子.广告");
  // Hindi
  // sanitize.emailAddress("अजय@डाटा.भारत"); TODO
  sanitize.emailAddress("अजय@अजय.रत");
  // Kannada
  // sanitize.emailAddress("ಬೆಂಬಲ@ಡೇಟಾಮೇಲ್.ಭಾರತ"); TODO
  // Greek
  sanitize.emailAddress("χρήστης@παράδειγμα.ελ");
  // German
  sanitize.emailAddress("Dörte@Sörensen.example.com");
  sanitize.emailAddress("Dörte@xn--srensen-90a.example.com");
  // Russian
  sanitize.emailAddress("коля@пример.рф");
  // Ukrainian
  sanitize.emailAddress("квіточка@пошта.укр");
  expect(() => {
    sanitize.emailAddress("d@d.xn-4dn5");
  }).toThrow();
  expect(() => {
    sanitize.emailAddress("d@d.xn--");
  }).toThrow();
  expect(() => {
    sanitize.emailAddress("d@d.xn-");
  }).toThrow();
});

test("Strip path separators from filenames", () => {
  expect(sanitize.filename("invoice.pdf")).toBe("invoice.pdf");
  expect(sanitize.filename("../../../home/u/.bashrc")).toBe("......homeu.bashrc");
  expect(sanitize.filename("a/b/c.txt")).toBe("abc.txt");
  expect(sanitize.filename("Ünïcödé Ñame.pdf")).toBe("Ünïcödé Ñame.pdf");
});

test("Strip path separators from filenames, without Unicode regexp support", () => {
  // node.js mobile has no `\p{Letter}` and throws
  let unicodeRegexp = sanitize.regexpFilename;
  sanitize.regexpFilename = {
    [Symbol.replace]() {
      throw new SyntaxError("Invalid regular expression: Invalid property name");
    },
  } as any;
  try {
    expect(sanitize.filename("invoice.pdf")).toBe("invoice.pdf");
    expect(sanitize.filename("../../../home/u/.bashrc")).toBe("......homeu.bashrc");
    expect(sanitize.filename("a/b/c.txt")).toBe("abc.txt");
  } finally {
    sanitize.regexpFilename = unicodeRegexp;
  }
});
