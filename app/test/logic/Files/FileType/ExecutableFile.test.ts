import { checkExecutableFile, executableMessage, ExecutableKind } from "../../../../logic/Files/FileType/ExecutableFile";
import { expect, test } from "vitest";

/** @param content What the file starts with. Given as a string of bytes. Empty = an empty file. */
function executable(filename: string, mimeType = "application/octet-stream", content = ""): Promise<ExecutableKind | null | undefined> {
  return checkExecutableFile(filename, mimeType, null,
    new Blob([Uint8Array.from(content, char => char.charCodeAt(0))]));
}

test("Every kind of executable file has a message for the end user", async () => {
  for (let kind of Object.values(ExecutableKind)) {
    expect(executableMessage(kind), kind).toBeTruthy();
  }
  expect(await executable("setup.exe")).toBe(ExecutableKind.program);
  expect(await executable("run.sh")).toBe(ExecutableKind.script);
  expect(await executable("invoice.lnk")).toBe(ExecutableKind.shortcut);
  expect(await executable("setup.msi")).toBe(ExecutableKind.installer);
  expect(await executable("budget.docm")).toBe(ExecutableKind.macros);
  expect(await executable("invoice.html")).toBe(ExecutableKind.webPage);
  expect(await executable("annex\u202Etxt.pdf")).toBe(ExecutableKind.disguised);
});

test("Programs and scripts are refused, by their file extension", async () => {
  for (let filename of ["setup.exe", "invoice.scr", "photos.jar", "run.sh", "install.msi",
    "start.desktop", "invoice.lnk", "budget.docm", "report.svg", "invoice.html", "cleanup.ps1",
    "server.rdp"]) {
    expect(await executable(filename), filename).toBeTruthy();
  }
});

test("Everyday documents can be opened", async () => {
  for (let filename of ["photo.jpg", "report.pdf", "letter.docx", "notes.txt", "invoice.odt",
    "budget.xlsx", "talk.pptx", "song.mp3", "movie.mp4", "backup.zip", "forwarded.eml", "readme"]) {
    expect(await executable(filename), filename).toBe(null);
  }
});

test("Only the last file extension decides, and upper case does not help", async () => {
  expect(await executable("invoice.pdf.exe")).toBeTruthy();
  expect(await executable("Invoice.EXE")).toBeTruthy();
  expect(await executable("exe.pdf")).toBe(null);
});

test("Windows ignores dots and spaces at the end of the filename, so we do, too", async () => {
  expect(await executable("invoice.exe.")).toBeTruthy();
  expect(await executable("invoice.exe ")).toBeTruthy();
  expect(await executable("invoice.exe . .")).toBeTruthy();
});

test("A filename that hides the real file type is refused", async () => {
  // U+202E flips the reading direction: This is displayed as `annexexe.txt`
  expect(await executable("annex\u202Etxt.exe")).toBeTruthy();
  // Even when the visible extension and the real extension are both harmless
  expect(await executable("annex\u202Etxt.pdf")).toBeTruthy();
});

test("A MIME type that runs code is refused, even with a harmless file extension", async () => {
  expect(await executable("photo.jpg", "application/x-msdownload")).toBeTruthy();
  expect(await executable("photo.jpg", "APPLICATION/X-MSDOWNLOAD; name=photo.jpg")).toBeTruthy();
  expect(await executable("photo.jpg", "image/jpeg")).toBe(null);
});

test("The file contents are checked, because the sender chose filename and MIME type", async () => {
  expect(await executable("notes.txt", "text/plain", "#!/bin/sh\nrm -rf ~")).toBeTruthy();
  expect(await executable("photo.jpg", "image/jpeg", "\x7FELF\x02\x01\x01")).toBeTruthy();
  expect(await executable("photo.jpg", "image/jpeg", "MZ\x90\x00\x03")).toBeTruthy();
  expect(await executable("shortcut", "application/octet-stream", "L\x00\x00\x00\x01\x14\x02\x00")).toBeTruthy();
  expect(await executable("menu", "application/octet-stream", "[Desktop Entry]\nExec=rm -rf ~")).toBeTruthy();
  // A byte order mark in front of the script must not hide it
  expect(await executable("notes.txt", "text/plain", "\xEF\xBB\xBF#!/bin/sh")).toBeTruthy();
  expect(await executable("notes.txt", "text/plain", "Dear Ben,\n\nthank you for")).toBe(null);
  expect(await executable("photo.jpg", "image/jpeg", "\xFF\xD8\xFF\xE0\x00\x10JFIF")).toBe(null);
});

test("Without the contents the file stays unchecked, but its name is still checked", async () => {
  expect(await checkExecutableFile("photo.jpg", "image/jpeg", "/gone/photo.jpg")).toBe(undefined);
  expect(await checkExecutableFile("setup.exe", "image/jpeg", "/gone/setup.exe")).toBeTruthy();
});
