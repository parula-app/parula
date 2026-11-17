// app first, to resolve the import cycle around Abstract/Account.ts
import "../../../logic/app";
import { Attachment } from "../../../logic/Abstract/Attachment";
import { UserError } from "../../../logic/util/util";
import { InMemoryFileReader } from "../util/fileReader";
import { beforeAll, expect, test } from "vitest";

const kContent = new Uint8Array([1, 2, 3, 4]);

beforeAll(() => {
  globalThis.FileReader ??= InMemoryFileReader as any;
});

test("Attachment contents as base64", async () => {
  let attachment = newAttachment();
  expect(await attachment.contentAsBase64()).toBe(Buffer.from(kContent).toString("base64"));
});

test("Attachment whose file is gone from disk reports the filename", async () => {
  let attachment = newAttachment();
  attachment.content.arrayBuffer = () => Promise.reject(new Error("File not found"));
  await expect(attachment.contentAsBase64()).rejects.toThrow(UserError);
  await expect(attachment.contentAsBase64()).rejects.toThrow("agenda.pdf");
});

function newAttachment(): Attachment {
  let attachment = new Attachment();
  attachment.filename = "agenda.pdf";
  attachment.mimeType = "application/pdf";
  attachment.content = new File([kContent as BlobPart], "agenda.pdf", { type: "application/pdf" });
  attachment.size = kContent.length;
  return attachment;
}
