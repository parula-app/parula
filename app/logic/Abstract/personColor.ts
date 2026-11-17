import { sha1 } from "@noble/hashes/legacy.js";

/**
 * A color that identifies a person, e.g. in an avatar placeholder.
 * It is always the same for the same `text`, e.g. an email address,
 * so that the user learns to associate the person with "their" color.
 *
 * The hue comes from the text as specified in XEP-0392
 * <https://xmpp.org/extensions/xep-0392.html>, so that other apps following
 * that spec pick the same color for the same person.
 * Saturation and lightness are ours: We darken the color until white text
 * on it reaches the contrast that WCAG 1.4.3 asks for.
 */
export function consistentColor(text: string): string {
  let known = colors.get(text);
  if (known) {
    return known;
  }
  const kSaturation = 0.62;
  const kBrightest = 0.5;
  const kDarkest = 0.24;
  const kMinContrast = 4.5;

  let hash = sha1(new TextEncoder().encode(text ?? ""));
  let hue = (hash[0] | hash[1] << 8) / 0x10000 * 360; // first 2 bytes, little endian
  // Yellow and green are far brighter than blue at the same lightness,
  // so darken them until the letter on top of them is readable.
  let rgb: number[];
  for (let lightness = kBrightest; ; lightness -= 0.02) {
    rgb = hslToRGB(hue, kSaturation, lightness);
    if (contrastWithWhite(rgb) >= kMinContrast || lightness <= kDarkest) {
      break;
    }
  }
  let color = "#" + rgb.map(part => Math.round(part * 255).toString(16).padStart(2, "0")).join("");
  colors.set(text, color);
  return color;
}

/** Cache, because this is called for every avatar that we paint */
const colors = new Map<string, string>();

/** All values, both in and out, are 0..1, except `hue`, which is 0..360 degrees */
function hslToRGB(hue: number, saturation: number, lightness: number): number[] {
  let chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  let sector = hue / 60;
  let second = chroma * (1 - Math.abs(sector % 2 - 1));
  let rgb =
    sector < 1 ? [chroma, second, 0] :
      sector < 2 ? [second, chroma, 0] :
        sector < 3 ? [0, chroma, second] :
          sector < 4 ? [0, second, chroma] :
            sector < 5 ? [second, 0, chroma] :
              [chroma, 0, second];
  let darken = lightness - chroma / 2;
  return rgb.map(part => part + darken);
}

/** Contrast ratio between white text and this background color, as defined by WCAG 2 */
function contrastWithWhite(rgb: number[]): number {
  let linear = (part: number) => part <= 0.03928 ? part / 12.92 : ((part + 0.055) / 1.055) ** 2.4;
  let luminance = 0.2126 * linear(rgb[0]) + 0.7152 * linear(rgb[1]) + 0.0722 * linear(rgb[2]);
  return 1.05 / (luminance + 0.05);
}
