/**
 * The changes from one version of a JMAP object to another,
 * as JSON pointer paths, for `Foo/set update`.
 * Only the changed parts, so that changes made elsewhere in the meantime stay.
 * <https://www.rfc-editor.org/rfc/rfc8620#section-5.3>
 */
export class JMAPPatchObject {
  static diff(before: Record<string, any>, after: Record<string, any>): Record<string, any> {
    let patch: Record<string, any> = {};
    JMAPPatchObject.addChanges(patch, "", before ?? {}, after ?? {});
    return patch;
  }

  protected static addChanges(patch: Record<string, any>, path: string, before: Record<string, any>, after: Record<string, any>) {
    let keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (let key of keys) {
      let keyPath = path + key.replaceAll("~", "~0").replaceAll("/", "~1");
      let oldValue = before[key];
      let newValue = after[key];
      if (newValue === undefined) {
        if (oldValue !== undefined) {
          patch[keyPath] = null;
        }
      } else if (JMAPPatchObject.isObject(oldValue) && JMAPPatchObject.isObject(newValue)) {
        JMAPPatchObject.addChanges(patch, keyPath + "/", oldValue, newValue);
      } else if (JSON.stringify(oldValue) != JSON.stringify(newValue)) {
        patch[keyPath] = newValue;
      }
    }
  }

  /** Arrays can only be replaced as a whole */
  protected static isObject(value: any): boolean {
    return !!value && typeof value == "object" && !Array.isArray(value);
  }
}
