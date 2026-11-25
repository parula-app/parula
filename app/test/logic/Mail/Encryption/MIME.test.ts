import { parseHeaderParameters, parseMIMEDirectSubparts, splitMIMEHeaders, toCRLFBytes } from "../../../../logic/Mail/Encryption/MIME";
import PostalMIME from "postal-mime";
import { expect, test, describe } from "vitest";

describe("MIME header parameters", () => {
  test("are split off the header value", () => {
    let params = parseHeaderParameters(`multipart/signed; protocol="application/pgp-signature"; micalg=pgp-sha256; boundary=Foo42`);
    expect(params.$main).toBe("multipart/signed");
    expect(params.protocol).toBe("application/pgp-signature");
    expect(params.micalg).toBe("pgp-sha256");
    expect(params.boundary).toBe("Foo42");
  });

  test("type and parameter names are case-insensitive, but the values are not", () => {
    let params = parseHeaderParameters(` Multipart/Signed; BOUNDARY="MixedCase42"`);
    expect(params.$main).toBe("multipart/signed");
    expect(params.boundary).toBe("MixedCase42");
  });

  test("header without parameters", () => {
    expect(parseHeaderParameters("text/plain").$main).toBe("text/plain");
  });

  test("missing header", () => {
    expect(parseHeaderParameters(null).$main).toBe("");
  });

  test("parameter without a name is skipped", () => {
    let params = parseHeaderParameters(`text/plain; =nonsense; charset=utf-8`);
    expect(params.charset).toBe("utf-8");
  });

  test("`;` and `=` within quotes belong to the value, and backslashes escape", () => {
    let params = parseHeaderParameters(`multipart/signed; boundary="A;B=C\\"D\\\\"; protocol="application/pgp-signature"`);
    expect(params.boundary).toBe(`A;B=C"D\\`);
    expect(params.protocol).toBe("application/pgp-signature");
  });

  test("comments are removed, but not within quotes", () => {
    let params = parseHeaderParameters(`multipart/signed (a (nested) comment; boundary=WRONG); boundary=RIGHT(comment); name="(not a comment)"`);
    expect(params.$main).toBe("multipart/signed");
    expect(params.boundary).toBe("RIGHT");
    expect(params.name).toBe("(not a comment)");
  });

  test("RFC 2231 continuations are joined, decoded, and replace a plain parameter", () => {
    let params = parseHeaderParameters(`text/plain; name="plain.txt"; name*1="b.txt"; name*0*=utf-8'en'%E2%82%AC%20`);
    expect(params.name).toBe("€ b.txt");
    expect(params["name*0*"]).toBeUndefined();
  });
});

/**
 * A signature check verifies the parts that `parseMIMEDirectSubparts()` finds,
 * but the reader shows what postal-mime parsed, so both must find the same parts.
 * Each of these headers could be read as one of two boundaries.
 */
describe("Multipart is split into the parts that postal-mime shows", () => {
  test.each([
    [`boundary="EVIL;X"`, `EVIL;X`, `"EVIL`],
    [`boundary="EV\\"IL"`, `EV"IL`, `EV\\"IL`],
    [`boundary=EVIL(comment)`, `EVIL`, `EVIL(comment)`],
    [`boundary=" EVIL "`, `EVIL`, ` EVIL `],
    [`boundary="ORIG"; boundary*0="SHO"; boundary*1="WN"`, `SHOWN`, `ORIG`],
    [`boundary*0*=utf-8''EV%49L; boundary=ORIG`, `EVIL`, `ORIG`],
    [`"x=1; boundary=EVIL; y="; boundary=ORIG`, `EVIL`, `ORIG`],
  ])("%s", async (parameters, boundary, otherBoundary) => {
    let contentType = `multipart/mixed; ${parameters}`;
    let mime = new TextEncoder().encode([
      `Content-Type: ${contentType}`,
      ``,
      `--${otherBoundary}`,
      `Content-Type: text/plain`,
      ``,
      `OTHER TEXT`,
      `--${otherBoundary}--`,
      `--${boundary}`,
      `Content-Type: text/plain`,
      ``,
      `SHOWN TEXT`,
      `--${boundary}--`,
      ``,
    ].join("\r\n"));
    let shown = (await PostalMIME.parse(mime)).text;
    expect(shown).toContain("TEXT");
    let parts = parseMIMEDirectSubparts(mime, contentType);
    expect(parts.length).toBe(1);
    expect(parts[0]).toContain(shown.trim());
  });

  test("Boundary lines may end with LF only, or with spaces", async () => {
    const contentType = `multipart/mixed; boundary="B"`;
    let mime = new TextEncoder().encode(`Content-Type: ${contentType}\r\n\r\n--B \nContent-Type: text/plain\n\nSHOWN TEXT\n--B--\t\n`);
    let parts = parseMIMEDirectSubparts(mime, contentType);
    expect(parts).toEqual(["Content-Type: text/plain\n\nSHOWN TEXT"]);
    expect((await PostalMIME.parse(mime)).text).toContain("SHOWN TEXT");
  });

  test("A line that only starts with the boundary is content", () => {
    const contentType = `multipart/mixed; boundary="B"`;
    let mime = new TextEncoder().encode([
      `Content-Type: ${contentType}`,
      ``,
      `--B`,
      ``,
      `--BX`,
      `--B--X`,
      `--B--`,
      ``,
    ].join("\r\n"));
    let parts = parseMIMEDirectSubparts(mime, contentType);
    expect(parts).toEqual(["\r\n--BX\r\n--B--X"]);
  });
});

test("Multipart with a mixed-case Content-Type is split into its parts", () => {
  const contentType = `Multipart/Signed; PROTOCOL="application/pgp-signature"; BOUNDARY="abc"`;
  let mime = new TextEncoder().encode([
    `Content-Type: ${contentType}`,
    ``,
    `--abc`,
    `Content-Type: text/plain`,
    ``,
    `Hello`,
    `--abc`,
    `Content-Type: application/pgp-signature`,
    ``,
    `SIGNATURE`,
    `--abc--`,
    ``,
  ].join("\r\n"));
  let parts = parseMIMEDirectSubparts(mime, contentType);
  expect(parts.length).toBe(2);
  expect(parts[0]).toBe("Content-Type: text/plain\r\n\r\nHello");
  expect(parts[1]).toBe("Content-Type: application/pgp-signature\r\n\r\nSIGNATURE");
});

describe("Splitting the headers off a MIME message", () => {
  // As nodemailer creates it, with folded headers and a nested multipart body
  const mime = [
    `From: a@example.com`,
    `Subject: =?UTF-8?Q?Gr=C3=BC=C3=9Fe_aus_M=C3=BCnchen=2C_ein_?=`,
    ` =?UTF-8?Q?sehr_langer_Betreff?=`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/alternative;`,
    ` boundary="--_NmP-1"`,
    ``,
    `----_NmP-1`,
    `Content-Type: text/plain; charset=utf-8`,
    `Content-Transfer-Encoding: 7bit`,
    ``,
    `Hello`,
    ``,
    `World`,
    `----_NmP-1--`,
    ``,
  ].join("\r\n");

  test("keeps folded headers together, with their original line breaks", async () => {
    let { headers } = await splitMIMEHeaders(mime);
    expect(headers.map(header => header.key)).toEqual(["from", "subject", "mime-version", "content-type"]);
    expect(headers[1].line).toBe(`Subject: =?UTF-8?Q?Gr=C3=BC=C3=9Fe_aus_M=C3=BCnchen=2C_ein_?=\r\n =?UTF-8?Q?sehr_langer_Betreff?=`);
    expect(headers[3].line).toBe(`Content-Type: multipart/alternative;\r\n boundary="--_NmP-1"`);
  });

  test("returns the entire body verbatim, as one string, without parsing the nested parts", async () => {
    let { body } = await splitMIMEHeaders(mime);
    expect(body).toBe(mime.slice(mime.indexOf("\r\n\r\n") + 4));
  });

  test("lowercases the header name in `key`, but keeps the original in `line`", async () => {
    let { headers } = await splitMIMEHeaders("X-Mixed-CASE: Value\r\n\r\nBody");
    expect(headers).toEqual([{ key: "x-mixed-case", line: "X-Mixed-CASE: Value" }]);
  });

  test("message without body", async () => {
    let { headers, body } = await splitMIMEHeaders("Subject: Only headers\r\n");
    expect(headers.map(header => header.line)).toEqual(["Subject: Only headers"]);
    expect(body).toBe("");
  });
});

describe("Line breaks of a message as bytes", () => {
  test("bare LF and bare CR become CRLF, CRLF stays", () => {
    let mime = new TextEncoder().encode("\nLF\nCR\rCRLF\r\nLF CR\n\rend\r");
    expect(new TextDecoder().decode(toCRLFBytes(mime))).toBe("\r\nLF\r\nCR\r\nCRLF\r\nLF CR\r\n\r\nend\r\n");
  });
});
