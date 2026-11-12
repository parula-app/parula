/* Mobile: Runs in the jailed page of `WebView.svelte`, whose taps our app can't see.
 * Tells the app about each tap. Stops web links, so that the app can ask the user first.
 * Leaves `mailto:` etc. to Android and iOS, as before. */
addEventListener("click", event => {
  let link = /** @type {Element} */ (event.target).closest("a");
  let url = ["https:", "http:"].includes(link?.protocol) ? link.href : null;
  if (url) {
    event.preventDefault();
  }
  parent.postMessage({ url, x: event.clientX, y: event.clientY }, "*");
});
