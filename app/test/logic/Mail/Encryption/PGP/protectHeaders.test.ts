import { PGPSend } from "../../../../../logic/Mail/Encryption/PGP/PGPSend";
import { expect, test } from "vitest";

// As nodemailer creates it, with a folded Subject and a nested multipart body
const mime = [
  `From: a@example.com`,
  `Subject: =?UTF-8?Q?Gr=C3=BC=C3=9Fe_aus_M=C3=BCnchen=2C_ein_?=`,
  ` =?UTF-8?Q?sehr_langer_Betreff?=`,
  `MIME-Version: 1.0`,
  `Content-Type: multipart/alternative;`,
  ` boundary="--_NmP-1"`,
  ``,
  `----_NmP-1`,
  `Content-Type: text/plain`,
  ``,
  `Hello`,
  `----_NmP-1--`,
  ``,
].join("\r\n");

test("Protected headers: The message headers move into the encrypted multipart/mixed, the body stays intact", async () => {
  let protectedMIME = await PGPSend.protectHeaders(mime);
  let boundary = protectedMIME.match(/boundary="([^"]+)"/)[1];
  expect(protectedMIME).toBe([
    `Content-Type: multipart/mixed; protected-headers="v1"; boundary="${boundary}"`,
    `From: a@example.com`,
    `Subject: =?UTF-8?Q?Gr=C3=BC=C3=9Fe_aus_M=C3=BCnchen=2C_ein_?=`,
    ` =?UTF-8?Q?sehr_langer_Betreff?=`,
    ``,
    `--${boundary}`,
    `Content-Type: multipart/alternative;`,
    ` boundary="--_NmP-1"`,
    ``,
    `----_NmP-1`,
    `Content-Type: text/plain`,
    ``,
    `Hello`,
    `----_NmP-1--`,
    `--${boundary}--`,
    ``,
  ].join("\r\n"));
});
