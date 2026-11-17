import "../../../../../logic/app";
import { setupTestFolder } from "../../SQL/setup";
import { expect, test } from "vitest";

test("A message that claims to be S/MIME, but is not, still shows its content", async () => {
  let { folder } = await setupTestFolder();
  let errors: Error[] = [];
  folder.account.errorCallback = (ex) => errors.push(ex);

  let email = folder.newEMail();
  email.mime = new TextEncoder().encode(kNotCMS.replace(/\n/g, "\r\n"));
  await email.parseMIME();

  expect(errors).toEqual([]);
  expect(await email.attachments.first.content.text()).toBe(kContent);
});

/** Long enough that its 2nd byte passes as an ASN.1 length,
 * so that the decoder gets as far as the tag, as in the error report */
const kContent = "This message was removed by the virus scanner. " +
  "The S/MIME part that it replaced is no longer available here.";

/** Declares `application/pkcs7-mime`, but the content is plain text */
const kNotCMS = `From: Alice <alice@example.com>
To: User <user@example.com>
Subject: Not S/MIME after all
Date: Tue, 14 Jul 2026 10:00:00 +0000
Message-ID: <not-cms@example.com>
MIME-Version: 1.0
Content-Disposition: attachment; filename="smime.p7m"
Content-Type: application/pkcs7-mime; smime-type=signed-data; name="smime.p7m"
Content-Transfer-Encoding: base64

${btoa(kContent)}
`;
