import { SizeRange, namedSizeRanges, sizeRangeBytes } from "../../../Mail/Search/SearchRanges";
import { expect, test } from "vitest";

test("Size ranges don't overlap", () => {
  let previousMax = -1;
  for (let size of namedSizeRanges) {
    let bytes = sizeRangeBytes(size);
    expect(bytes.min ?? 0).toBe(previousMax + 1);
    previousMax = bytes.max;
  }
  expect(previousMax).toBeNull();
  expect(sizeRangeBytes(SizeRange.Any)).toEqual({ min: null, max: null });
});
