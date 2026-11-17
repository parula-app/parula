/**
 * @param hex a background color, as HTML hex with `#`
 * @returns either black or white,
 *   depending on what gives the best contrast,
 *   as HTML hex with `#`
 */
export function contrastTextColor(hex: string): "#ffffff" | "#000000" {
    let h = hex.replace(/^#/, "");
    let r = parseInt(h.slice(0, 2), 16);
    let g = parseInt(h.slice(2, 4), 16);
    let b = parseInt(h.slice(4, 6), 16);
    let yiq = (r * 299 + g * 587 + b * 114) / 1000;
    return yiq >= 128 ? "#000000" : "#ffffff";
}

export function applyColors(colors: Record<string, string>, doc: Document) {
  console.log("apply colors", colors);
  let style = doc.documentElement.style;
  for (let cssVar in colors) {
    let color = colors[cssVar];
    console.log("apply color", cssVar, color);
    if (color) {
      style.setProperty("--" + cssVar, color);
    } else {
      style.removeProperty("--" + cssVar);
    }
  }

  // Remove vars that have been cleared from the colors list
  for (let i = 0; i < style.length; i++) {
    let oldVar = style[i];
    if (!oldVar.startsWith('--')) {
      continue;
    }
    oldVar = oldVar.substring(2);
    if (!colors[oldVar]) {
      style.removeProperty("--" + oldVar);
    }
  }
}
