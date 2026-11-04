// @vitest-environment happy-dom
import { SignatureEdits } from "../../../Mail/Composer/SignatureEdits";
import type { MailIdentity } from "../../../../logic/Mail/MailIdentity";
import { expect, test, vi } from "vitest";

function newIdentity(id: string, signatureHTML: string | null): MailIdentity {
  // Only the parts that SignatureEdits uses
  return { id, signatureHTML, save: vi.fn(async () => {}) } as unknown as MailIdentity;
}

test("Empty editor content counts as no signature", () => {
  expect(SignatureEdits.hasText(null)).toBe(false);
  expect(SignatureEdits.hasText("<p></p>")).toBe(false);
  expect(SignatureEdits.hasText("<p> </p><p></p>")).toBe(false);
  expect(SignatureEdits.hasText("<p>Fred</p>")).toBe(true);
  expect(SignatureEdits.hasText("<p><img src=\"logo.png\"></p>")).toBe(true);
});

test("Edits start with the saved signature and are not changed until edited", () => {
  let fred = newIdentity("1", "<p>Fred</p>");
  let edits = new SignatureEdits();
  edits.start(fred);
  expect(edits.edits["1"]).toBe("<p>Fred</p>");
  expect(edits.isChanged(fred)).toBe(false);
  edits.edits["1"] = "<p>Fred Miller</p>";
  expect(edits.isChanged(fred)).toBe(true);
  // Starting again keeps the edit
  edits.start(fred);
  expect(edits.edits["1"]).toBe("<p>Fred Miller</p>");
});

test("An empty paragraph is no change for an identity without signature", () => {
  let anna = newIdentity("2", null);
  let edits = new SignatureEdits();
  edits.start(anna);
  edits.edits["2"] = "<p></p>";
  expect(edits.isChanged(anna)).toBe(false);
});

test("Saves only changed identities, and an emptied signature as null", async () => {
  let fred = newIdentity("1", "<p>Fred</p>");
  let anna = newIdentity("2", "<p>Anna</p>");
  let bert = newIdentity("3", "<p>Bert</p>");
  let edits = new SignatureEdits();
  edits.start(fred);
  edits.start(anna);
  edits.start(bert);
  edits.edits["1"] = "<p>Fred Miller</p>";
  edits.edits["2"] = "<p></p>";
  await edits.saveAll();
  expect(fred.signatureHTML).toBe("<p>Fred Miller</p>");
  expect(anna.signatureHTML).toBeNull();
  expect(bert.signatureHTML).toBe("<p>Bert</p>");
  expect(fred.save).toHaveBeenCalledTimes(1);
  expect(anna.save).toHaveBeenCalledTimes(1);
  expect(bert.save).not.toHaveBeenCalled();
  expect(edits.isChanged(fred)).toBe(false);
});
