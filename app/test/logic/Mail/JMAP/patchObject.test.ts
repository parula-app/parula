import { JMAPPatchObject } from "../../../../logic/Mail/JMAP/JMAPPatchObject";
import { applyPatch } from "../../Calendar/JMAP/applyPatch";
import { expect, test } from "vitest";

/** The pointers in `patch` that make it an invalid PatchObject for `before`, RFC 8620 section 5.3:
 * one pointer is the prefix of another, a pointer goes into an array, or its parent doesn't exist */
function invalidPointers(before: Record<string, any>, patch: Record<string, any>): string[] {
  let tokens = (path: string) => path.split("/").map(key => key.replaceAll("~1", "/").replaceAll("~0", "~"));
  let isPrefix = (a: string, b: string) => a != b && b.startsWith(a + "/");
  return Object.keys(patch).filter(path => {
    if (Object.keys(patch).some(other => isPrefix(other, path))) {
      return true;
    }
    let parent: any = before;
    for (let key of tokens(path).slice(0, -1)) {
      if (Array.isArray(parent) || !parent || typeof parent != "object" || !(key in parent)) {
        return true;
      }
      parent = parent[key];
    }
    return Array.isArray(parent) || !parent || typeof parent != "object";
  });
}

/** The pointers in `patch` that touch one of the `unchanged` parts: the part itself, inside it, or a part around it */
function touchedUnchanged(patch: Record<string, any>, unchanged: string[]): string[] {
  return Object.keys(patch).filter(path => unchanged.some(part =>
    path == part || path.startsWith(part + "/") || part.startsWith(path + "/")));
}

/** `diff()` gives a valid patch that turns `before` into `after`, and leaves `unchanged` alone */
function expectPatch(before: Record<string, any>, after: Record<string, any>, unchanged: string[]) {
  let patch = JMAPPatchObject.diff(before, after);
  expect(applyPatch(before, patch)).toEqual(after);
  expect(invalidPointers(before, patch)).toEqual([]);
  expect(touchedUnchanged(patch, unchanged)).toEqual([]);
}

test("Only the changed properties, so that changes made elsewhere stay", () => {
  let before = { name: { full: "Jane", isOrdered: true }, emails: { e1: { address: "a@example.com" }, e2: { address: "b@example.com" } } };
  let after = { name: { full: "Jane Doe", isOrdered: true }, emails: { e1: { address: "a@example.com" }, e2: { address: "c@example.com" } } };
  expectPatch(before, after, ["name/isOrdered", "emails/e1"]);
});

test("Removed and added properties", () => {
  let before = { emails: { e1: { address: "a@example.com", label: "old" } }, notes: { n1: { note: "x" } }, kind: "individual" };
  let after = { emails: { e1: { address: "a@example.com" }, e2: { address: "b@example.com" } }, media: { m1: { kind: "photo", uri: "data:," } }, kind: "individual" };
  expectPatch(before, after, ["emails/e1/address", "kind"]);
});

test("Arrays are replaced as a whole", () => {
  let before = { name: { components: [{ kind: "given", value: "Jane" }, { kind: "surname", value: "Doe" }], isOrdered: true } };
  let after = { name: { components: [{ kind: "given", value: "Jane" }, { kind: "surname", value: "Smith" }], isOrdered: true } };
  expectPatch(before, after, ["name/isOrdered"]);
});

test("Keys with `/` and `~` are escaped", () => {
  let before = { relatedTo: { "https://example.com/jane": { relation: { friend: true } }, "urn:x~y": { relation: { parent: true } } } };
  let after = { relatedTo: { "https://example.com/jane": { relation: { spouse: true } }, "urn:x~y": { relation: { parent: true } }, "a~b": { relation: {} } } };
  expectPatch(before, after, ["relatedTo/urn:x~0y"]);
});

test("No changes, no patch", () => {
  let card = { name: { full: "Jane" }, emails: { e1: { address: "a@example.com" } } };
  expectPatch(card, structuredClone(card), ["name", "emails"]);
});
