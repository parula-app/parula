import { vi } from "vitest";

// Git for Windows checks text files out with CRLF line endings (its default core.autocrlf=true),
// and Vite's `?raw` gives the file as it is on disk.
vi.mock("../../../../../logic/Mail/Encryption/SMIME/roots/mozilla-not-email-roots.txt?raw", async (importOriginal) => {
  let list = await importOriginal<{ default: string }>();
  return { default: list.default.replaceAll("\n", "\r\n") };
});

// The same tests, with that root list
import "./rootCertificates.test";
