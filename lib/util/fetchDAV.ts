/**
 * `fetch()` for tsdav, with a workaround for SOGo.
 *
 * SOGo writes characters outside of the Unicode BMP, e.g. emojis, as 2 XML
 * character references, one for each UTF-16 surrogate, e.g. 😃 as `&#55357;&#56835;`.
 * It does that at least in the response to the sync-collection REPORT,
 * which we use to sync calendars and address books.
 * That's invalid XML, so the XML parser of tsdav rejects the whole response,
 * and the sync fails with "Collection sync failed: 207 Multi-Status".
 * <https://github.com/parula-app/parula/issues/1780>
 *
 * We replace each such reference with the surrogate itself.
 * 2 of them together form the character in a JS string.
 */
export async function fetchDAV(url: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  let response = await fetch(url, init);
  if (response.status != 207) { // SOGo sends its DAV XML as 207 Multi-Status
    return response;
  }
  let xml = (await response.text()).replace(/&#(\d+);/g, (ref, code) =>
    code >= 0xD800 && code <= 0xDFFF ? String.fromCharCode(code) : ref);
  return new Response(xml, response);
}
