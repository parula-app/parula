/** node has no `FileReader`, which `blobToDataURL()` uses.
 * Reads the blob directly, and fails the same way as the browser does,
 * when the file was deleted or changed on disk after the user picked it. */
export class InMemoryFileReader {
  result: string;
  error: DOMException;
  onload: () => void;
  onerror: () => void;

  async readAsDataURL(blob: Blob) {
    try {
      let base64 = Buffer.from(await blob.arrayBuffer()).toString("base64");
      this.result = `data:${blob.type};base64,${base64}`;
      this.onload();
    } catch (ex) {
      this.error = new DOMException(ex.message, "NotReadableError");
      this.onerror();
    }
  }
}
