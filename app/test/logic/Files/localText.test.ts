// @vitest-environment happy-dom
import { File } from "../../../logic/Files/File";
import { Directory } from "../../../logic/Files/Directory";
import { appGlobal } from "../../../logic/app";
import AdmZip from "adm-zip";
import { convert } from "html-to-text";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

// DOMPurify does not work on happy-dom, @see `sanitizeHTML()`.
// Use the same HTML to text converter, without the sanitizing.
vi.mock("../../../logic/util/convertHTML", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../logic/util/convertHTML")>(),
  convertHTMLToText: (html: string) => convert(html),
}));

// happy-dom's `getElementsByTagNameNS("*", localName)` finds nothing in documents from `DOMParser`.
// Browsers find all elements with that local name, in any namespace.
// The `DOMParser` documents are not of the global `Document` class, so patch the classes that they use.
function classWith(obj: object, method: string): any {
  for (let proto = obj; proto; proto = Object.getPrototypeOf(proto)) {
    if (Object.prototype.hasOwnProperty.call(proto, method)) {
      return proto;
    }
  }
}
let xmlDoc = new DOMParser().parseFromString("<root/>", "application/xml");
for (let proto of new Set([classWith(xmlDoc, "getElementsByTagNameNS"), classWith(xmlDoc.documentElement, "getElementsByTagNameNS")])) {
  let original = proto.getElementsByTagNameNS;
  proto.getElementsByTagNameNS = function (namespace: string, localName: string) {
    if (namespace != "*") {
      return original.call(this, namespace, localName);
    }
    return Array.from(this.getElementsByTagName("*") as HTMLCollection)
      .filter(el => el.localName == localName);
  } as any;
}

const kODTContent = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content
    xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
    xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0">
  <office:body>
    <office:text>
      <text:h text:outline-level="1">Quarterly report</text:h>
      <text:p>Revenue grew in <text:span>Lisbon</text:span>.</text:p>
      <text:p>Second paragraph</text:p>
    </office:text>
  </office:body>
</office:document-content>`;

const kDOCXContent = `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Invoice</w:t></w:r></w:p>
    <w:p><w:r><w:t xml:space="preserve">Payment to </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>Porto</w:t></w:r></w:p>
    <w:p><w:r><w:t>Due next month</w:t></w:r></w:p>
  </w:body>
</w:document>`;

function zip(entryName: string, content: string): Uint8Array {
  let zip = new AdmZip();
  zip.addFile("mimetype", Buffer.from("application/zip"));
  zip.addFile(entryName, Buffer.from(content, "utf-8"));
  return new Uint8Array(zip.toBuffer());
}

/** What the files on disk contain, by path */
let disk: Map<string, Uint8Array>;
let readFile: ReturnType<typeof vi.fn>;

beforeEach(() => {
  disk = new Map();
  readFile = vi.fn(async (path: string) => {
    let contents = disk.get(path);
    if (!contents) {
      throw new Error("File not found: " + path);
    }
    return contents;
  });
  appGlobal.remoteApp = { readFile };
});

afterEach(() => {
  appGlobal.remoteApp = null;
});

function newFile(name: string): File {
  let dir = new Directory();
  dir.path = "/";
  return dir.newFile(name);
}

/** A file whose contents we downloaded, and keep in memory */
function inMemory(name: string, contents: Uint8Array | string): File {
  let file = newFile(name);
  file.contents = new Blob([contents]);
  file.size = file.contents.size;
  return file;
}

/** A file whose contents are on the local disk, but not in memory */
function onDisk(name: string, contents: Uint8Array | string): File {
  let file = newFile(name);
  file.filepathLocal = "/home/user/Documents/" + name;
  let bytes = typeof contents == "string" ? new TextEncoder().encode(contents) : contents;
  disk.set(file.filepathLocal, bytes);
  file.size = bytes.length;
  return file;
}

function expectWords(text: string | null, words: string[]) {
  expect(text).toBeTruthy();
  for (let word of words) {
    expect(text.toLowerCase()).toContain(word.toLowerCase());
  }
  expect(text).not.toMatch(/<\/?[a-z]/i); // no markup
}

test("OpenDocument text", async () => {
  let text = await inMemory("report.odt", zip("content.xml", kODTContent)).localText();
  expectWords(text, ["Quarterly report", "Revenue grew in Lisbon", "Second paragraph"]);
  // Paragraphs don't run into each other
  expect(text).toMatch(/Lisbon\.\s+Second/);
});

test("Word document", async () => {
  let text = await onDisk("Invoice.DOCX", zip("word/document.xml", kDOCXContent)).localText();
  expectWords(text, ["Invoice", "Payment to Porto", "Due next month"]);
});

test("Markdown, plain text and HTML", async () => {
  expectWords(await inMemory("README.md", "# Setup\n\nRun **make** in Faro").localText(), ["Setup", "Run", "make", "in Faro"]);
  expectWords(await onDisk("notes.TXT", "Meeting in Évora, 10:00").localText(), ["Meeting in Évora, 10:00"]);
  expectWords(await onDisk("page.html", "<html><body><h1>Welcome</h1><p>Hotel in <b>Braga</b></p></body></html>").localText(), ["Welcome", "Hotel in Braga"]);
});

test("Formats that we can't read have no text", async () => {
  expect(await inMemory("photo.jpg", "\xff\xd8\xff\xe0 Coimbra").localText()).toBeNull();
  expect(await onDisk("slides.pdf", "%PDF-1.7 Coimbra").localText()).toBeNull();
  expect(await onDisk("archive", "Coimbra").localText()).toBeNull();
});

test("Never downloads: a file that is neither in memory nor on disk has no text", async () => {
  let file = newFile("letter.docx");
  file.size = 1000;
  let download = vi.spyOn(file, "download");
  expect(await file.localText()).toBeNull();
  expect(download).not.toHaveBeenCalled();
  expect(readFile).not.toHaveBeenCalled();
});

test("Large files are not read", async () => {
  let file = onDisk("server.txt", "Aveiro");
  file.size = 2 * 1024 * 1024 * 1024;
  expect(await file.localText()).toBeNull();
  expect(readFile).not.toHaveBeenCalled();
});

test("Reads each file only once, until it changes", async () => {
  let file = onDisk("todo.md", "Buy tickets to Sintra");
  expectWords(await file.localText(), ["Sintra"]);
  expectWords(await file.localText(), ["Sintra"]);
  expect(readFile).toHaveBeenCalledTimes(1);

  disk.set(file.filepathLocal, new TextEncoder().encode("Buy tickets to Cascais"));
  file.lastMod = new Date(file.lastMod.getTime() + 60000);
  expectWords(await file.localText(), ["Cascais"]);
  expect(readFile).toHaveBeenCalledTimes(2);
});

test("A broken document throws, without hanging", async () => {
  await expect(onDisk("broken.docx", "This is not a ZIP file").localText()).rejects.toThrow();
  let file = onDisk("deleted.txt", "Tavira");
  disk.delete(file.filepathLocal);
  await expect(file.localText()).rejects.toThrow();
});
