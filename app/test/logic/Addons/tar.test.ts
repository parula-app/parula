import { gunzip, readStreamBounded, readTar } from "../../../logic/util/tar";
import { gzip, makeTar, paxPath } from "./testPackage";
import { expect, test } from "vitest";

const kMB = 1024 * 1024;

function text(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

test("Reads files and skips directories", () => {
  let files = readTar(makeTar([
    { path: "package/", type: "5" },
    { path: "package/package.json", contents: "{}" },
    { path: "package/dist/main.js", contents: "let a = 1;" },
    { path: "package/empty.txt", contents: "" },
  ]), 1000, 50 * kMB);
  expect([...files.keys()].sort()).toEqual(["package/dist/main.js", "package/empty.txt", "package/package.json"]);
  expect(text(files.get("package/dist/main.js"))).toBe("let a = 1;");
  expect(files.get("package/empty.txt").length).toBe(0);
});

test("Reads file contents across several blocks", () => {
  let big = "x".repeat(1500);
  let files = readTar(makeTar([
    { path: "a.txt", contents: big },
    { path: "b.txt", contents: "after" },
  ]), 1000, 50 * kMB);
  expect(text(files.get("a.txt"))).toBe(big);
  expect(text(files.get("b.txt"))).toBe("after");
});

test("Long paths: ustar prefix, PAX header and GNU long name", () => {
  let long = "dir/".repeat(40) + "file.js";
  let files = readTar(makeTar([
    { path: "file.js", prefix: "package/sub", contents: "1" },
    paxPath("package/" + long),
    { path: "package/truncated", contents: "2" },
    { path: "././@LongLink", type: "L", contents: "package/gnu/" + long + "\0" },
    { path: "package/gnu/truncated", contents: "3" },
  ]), 1000, 50 * kMB);
  expect(text(files.get("package/sub/file.js"))).toBe("1");
  expect(text(files.get("package/" + long))).toBe("2");
  expect(text(files.get("package/gnu/" + long))).toBe("3");
  expect(files.has("package/truncated")).toBe(false);
});

test("Normalizes ./ and double slashes, and allows the root directory entry of `tar -C dir .`", () => {
  let files = readTar(makeTar([
    { path: "./", type: "5" },
    { path: "./package//a.js", contents: "a" },
  ]), 1000, 50 * kMB);
  expect([...files.keys()]).toEqual(["package/a.js"]);
});

test.each([
  ["../evil.js"],
  ["package/../../evil.js"],
  ["package/sub/../../../evil.js"],
  ["/etc/passwd"],
  ["C:/Windows/evil.dll"],
  ["package\\..\\evil.js"],
  ["package/a\nb.js"],
  ["."],
])("Rejects path %j that could point outside", (path) => {
  expect(() => readTar(makeTar([{ path, contents: "x" }]), 1000, 50 * kMB)).toThrow();
});

test("Rejects .. in a directory entry, and in a PAX path", () => {
  expect(() => readTar(makeTar([{ path: "package/../", type: "5" }]), 1000, 50 * kMB)).toThrow();
  expect(() => readTar(makeTar([paxPath("../evil.js"), { path: "package/ok.js", contents: "x" }]), 1000, 50 * kMB)).toThrow();
});

test.each([
  ["1", "hard link"],
  ["2", "symlink"],
  ["3", "character device"],
  ["4", "block device"],
  ["6", "FIFO"],
  ["S", "unknown type"],
])("Rejects type %s (%s)", (type) => {
  let tar = makeTar([
    { path: "package/ok.js", contents: "x" },
    { path: "package/link", type, linkName: "/etc/passwd" },
  ]);
  expect(() => readTar(tar, 1000, 50 * kMB)).toThrow(/link or special file/);
});

test("Rejects the same file twice", () => {
  expect(() => readTar(makeTar([
    { path: "package/a.js", contents: "1" },
    { path: "package/a.js", contents: "2" },
  ]), 1000, 50 * kMB)).toThrow();
});

test("Limits the number of entries", () => {
  let entries = Array.from({ length: 11 }, (_, i) => ({ path: `f${i}.js`, contents: "x" }));
  expect(readTar(makeTar(entries.slice(0, 10)), 10, 50 * kMB).length).toBe(10);
  expect(() => readTar(makeTar(entries), 10, 50 * kMB)).toThrow(/more than 10 entries/);
});

test("Limits the total size of the contents", () => {
  let tar = makeTar([
    { path: "a.bin", contents: new Uint8Array(600) },
    { path: "b.bin", contents: new Uint8Array(600) },
  ]);
  expect(readTar(tar, 1000, 1200).length).toBe(2);
  expect(() => readTar(tar, 1000, 1199)).toThrow(/larger than/);
});

test("Rejects a truncated archive, a missing end marker and a bad checksum", () => {
  let tar = makeTar([{ path: "a.bin", contents: new Uint8Array(2000) }]);
  expect(() => readTar(tar.subarray(0, 1000), 1000, 50 * kMB)).toThrow(/truncated/);
  expect(() => readTar(tar.subarray(0, 512 * 5), 1000, 50 * kMB)).toThrow(/end marker/);
  let corrupt = tar.slice();
  corrupt[10] ^= 1;
  expect(() => readTar(corrupt, 1000, 50 * kMB)).toThrow(/checksum/);
});

test("A size field that claims more than the archive has", () => {
  let tar = makeTar([{ path: "a.bin", contents: "x" }]);
  // size field: 0o77777777777 bytes, with a fixed checksum
  let header = tar.subarray(0, 512);
  header.set(new TextEncoder().encode("77777777777\0"), 124);
  header.fill(0x20, 148, 156);
  let sum = header.reduce((total, byte) => total + byte, 0);
  header.set(new TextEncoder().encode(sum.toString(8).padStart(6, "0") + "\0 "), 148);
  expect(() => readTar(tar, 1000, 50 * kMB)).toThrow();
});

test("gunzip", async () => {
  let data = new TextEncoder().encode("hello ".repeat(1000));
  expect(await gunzip(gzip(data), 6000)).toEqual(data);
});

test("gunzip stops a zip bomb at the limit", async () => {
  let bomb = gzip(new Uint8Array(20 * kMB));
  expect(bomb.length).toBeLessThan(100 * 1024);
  await expect(gunzip(bomb, kMB)).rejects.toThrow(/larger than/);
});

test("gunzip rejects data that is not gzip", async () => {
  await expect(gunzip(new TextEncoder().encode("not gzip at all"), kMB)).rejects.toThrow();
});

test("readStreamBounded", async () => {
  let stream = new Blob([new Uint8Array(1000), new Uint8Array(1000)]).stream();
  expect((await readStreamBounded(stream, 2000)).length).toBe(2000);
  stream = new Blob([new Uint8Array(1000), new Uint8Array(1001)]).stream();
  await expect(readStreamBounded(stream, 2000)).rejects.toThrow();
});
