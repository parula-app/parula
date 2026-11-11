// Runs in the addon's worker, before every message that the user sends
mustang.hooks.before("mail.send", async ({ email }) => {
  const kMark = " (checked)";
  let ownText = (await email.text)
    .split("\n")
    .filter(line => !line.startsWith(">"))
    .join("\n");
  await mustang.loaded(email.attachments);
  if (email.attachments.isEmpty && /\b(attach|anbei\b|anhang|angehängt)/i.test(ownText)) {
    return { cancel: "The text mentions an attachment, but there is none" };
  }
  if (!email.subject.endsWith(kMark)) {
    email.subject += kMark;
  }
});
