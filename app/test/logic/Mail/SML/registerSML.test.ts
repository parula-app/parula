import { setupTestFolder } from "../SQL/setup";
import { EMailProcessorList } from "../../../../logic/Mail/EMailProcessor";
import { dataProcessorsHookup } from "../../../../logic/Mail/SML/DataProcessors";
import { RegisterSMLProcessor } from "../../../../logic/Mail/SML/RegisterSMLProcessor";
import { MailIdentity } from "../../../../logic/Mail/MailIdentity";
import { findOrCreatePersonUID } from "../../../../logic/Abstract/PersonUID";
import { expect, test } from "vitest";

/** Anybody can send us such a registration confirmation. When we never asked
 * for one, we must ignore it, and not break the email that carries it. */
test("SML registration that we did not request", async () => {
  let { folder } = await setupTestFolder();
  let identity = new MailIdentity(folder.account);
  identity.emailAddress = "user@example.com";
  identity.realname = "User";
  folder.account.identities.add(identity);
  dataProcessorsHookup(); // as the app does on startup
  let processor = EMailProcessorList.processors.find(p => p instanceof RegisterSMLProcessor) as RegisterSMLProcessor;

  let email = folder.newEMail();
  email.to.add(findOrCreatePersonUID("user@example.com", "User"));

  await expect(processor.processSML(email, kRegistrationSML)).resolves.toBeUndefined();
});

const kRegistrationSML = {
  "@context": "https://sml.mustang.im",
  "@type": "EMailRegisterAction",
  object: {
    "@type": "Account",
    emailAddress: "user@example.com",
  },
  target: "https://sml.example.com/confirm?token=abc",
};
