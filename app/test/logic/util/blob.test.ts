import { base64ToUint8Array, uint8ArrayToBase64 } from "../../../logic/util/blob";
import { expect, test } from "vitest";

test("uint8ArrayToBase64() encodes all byte values, also for large arrays", () => {
  // Larger than the chunks of the fallback, and not a multiple of them
  let bytes = Uint8Array.from({ length: 100003 }, (_, i) => (i * 7) % 256);

  let base64 = uint8ArrayToBase64(bytes);

  expect(base64).toBe(Buffer.from(bytes).toString("base64"));
  expect(base64ToUint8Array(base64)).toEqual(bytes);
});

test("uint8ArrayToBase64() encodes UTF-8 text", () => {
  let text = "Projekt Größe 😀";

  let base64 = uint8ArrayToBase64(new TextEncoder().encode(text));

  expect(new TextDecoder().decode(base64ToUint8Array(base64))).toBe(text);
  expect(uint8ArrayToBase64(new Uint8Array())).toBe("");
});
