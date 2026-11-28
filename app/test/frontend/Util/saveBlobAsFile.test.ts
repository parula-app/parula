import { appGlobal } from "../../../logic/app";
import { saveBlobAsFile } from "../../../frontend/Util/util";
import { beforeEach, expect, test } from "vitest";

/** What the user chooses in the save dialog. null = Cancel */
let chosenPath: string | null;
/** The file name that the save dialog proposed */
let proposedName: string;
/** The files that the backend wrote. Path -> content */
let written: Map<string, string>;

beforeEach(() => {
  written = new Map();
  appGlobal.remoteApp = {
    askWhereToSaveFile: async (filename: string) => {
      proposedName = filename;
      return chosenPath;
    },
    writeFile: async (path: string, permissions: number, contents: Uint8Array) => {
      written.set(path, new TextDecoder().decode(contents));
    },
  } as any;
});

test("Desktop: Saves the file where the user chose", async () => {
  chosenPath = "/home/user/Documents/invoice.pdf";
  await saveBlobAsFile(new File(["attachment content"], "invoice.pdf"));
  expect(proposedName).toBe("invoice.pdf");
  expect(written.get("/home/user/Documents/invoice.pdf")).toBe("attachment content");
});

test("Desktop: Saves nothing when the user cancels", async () => {
  chosenPath = null;
  await saveBlobAsFile(new File(["attachment content"], "invoice.pdf"));
  expect(written.size).toBe(0);
});
