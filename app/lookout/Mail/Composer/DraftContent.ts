export function hasUserText(html: string): boolean {
  // <copied from="../../../frontend/Mail/Composer/CloseButton.svelte" checkDirty()>
  let text = withoutQuotes(html).body.textContent ?? "";
  text = text.replace(/\s+/g, "").trim();
  return text.length >= 100; // Ignore attribution line before quote. TODO Match more precisely
  // </copied>
}

function withoutQuotes(html: string): Document {
  // <copied from="../../../frontend/Mail/Composer/CloseButton.svelte" notQuote()>
  let doc = new DOMParser().parseFromString(html, "text/html");
  for (let blockquote of doc.body.querySelectorAll("blockquote")) {
    blockquote.remove();
  }
  return doc;
  // </copied>
}
