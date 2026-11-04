/** What the server stores after `Foo/set update` with `patch`.
 * <https://www.rfc-editor.org/rfc/rfc8620#section-5.3> */
export function applyPatch<T>(object: T, patch: Record<string, any>): T {
  let result = structuredClone(object);
  for (let [path, value] of Object.entries(patch)) {
    let keys = path.split("/").map(key => key.replaceAll("~1", "/").replaceAll("~0", "~"));
    let last = keys.pop();
    let parent = keys.reduce((obj, key) => obj[key], result as any);
    if (value === null) {
      delete parent[last];
    } else {
      parent[last] = value;
    }
  }
  return result;
}
