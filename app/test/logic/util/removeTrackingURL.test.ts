import { removeTrackingURL } from "../../../logic/util/netUtil";
import { expect, test } from "vitest";

const kDestination = "https://www.shop.com/shoes?size=42";
const kTrackingLink = "https://click.tracker.com/c?id=5&u=" + encodeURIComponent(kDestination) + "&e=fred";

test("Find where a tracking link goes", () => {
  expect(removeTrackingURL(kTrackingLink)).toBe(kDestination);
  expect(removeTrackingURL("https://click.tracker.com/c?u=https://www.shop.com/")).toBe("https://www.shop.com/");
  expect(removeTrackingURL("http://click.tracker.com/c?u=https://www.shop.com/")).toBe("https://www.shop.com/");
  expect(removeTrackingURL("https://www.shop.com/shoes?size=42")).toBe("https://www.shop.com/shoes?size=42");
  expect(removeTrackingURL("https://www.shop.com/")).toBe("https://www.shop.com/");
});

test("Only to https: web pages", () => {
  for (let url of [
    "https://click.tracker.com/c?u=http://www.shop.com/",
    "https://click.tracker.com/c?u=javascript:alert(1)",
    "https://click.tracker.com/c?u=mailto:fred@foo.com",
    "https://click.tracker.com/c?u=https://",
    // A link to another app stays as it is
    "mailto:fred@foo.com?body=https://www.shop.com/",
    "not a URL",
  ]) {
    expect(removeTrackingURL(url)).toBe(url);
  }
});
