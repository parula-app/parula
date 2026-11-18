import type { APIClass, APIEnum, APIMember } from "../API/addon";
import { SetColl } from "svelte-collections";

/** The allowlist of `apiTypes.ts`, prepared for lookups with names that come from addons */
export class AddonAPI {
  /** The index is the class number that the addon sees */
  readonly classes: APIClass[];
  protected byPrototype = new Map<object, APIClass>();
  protected byName = new Map<string, APIClass>();
  protected numbers = new Map<APIClass, number>();
  /** Including the members of the superclasses */
  protected members = new Map<APIClass, Map<string, APIMember>>();
  protected enumValues = new Map<string, SetColl<string | number>>();

  constructor(classes: APIClass[], enums: APIEnum[]) {
    this.classes = classes;
    for (let cls of classes) {
      this.byName.set(cls.name, cls);
    }
    for (let [i, cls] of classes.entries()) {
      this.numbers.set(cls, i);
      this.byPrototype.set(cls.class.prototype, cls);
      let members = new Map<string, APIMember>();
      const kMaxSuperclasses = 100;
      let superclass = cls;
      for (let level = 0; superclass && level < kMaxSuperclasses; level++) {
        for (let member of superclass.members) {
          if (!members.has(member.name)) {
            members.set(member.name, member);
          }
        }
        superclass = superclass.extends ? this.byName.get(superclass.extends) : null;
      }
      this.members.set(cls, members);
    }
    for (let apiEnum of enums) {
      this.enumValues.set(apiEnum.name, new SetColl(apiEnum.values));
    }
  }

  /** The class as which `obj` crosses to addons: the nearest class with groups in its prototype chain.
   * null, if it may not cross. */
  classOf(obj: object): APIClass | null {
    const kMaxPrototypes = 100;
    let prototype = Object.getPrototypeOf(obj);
    for (let level = 0; prototype && level < kMaxPrototypes; level++) {
      let cls = this.byPrototype.get(prototype);
      if (cls?.groups) {
        return cls;
      }
      prototype = Object.getPrototypeOf(prototype);
    }
    return null;
  }

  classByName(name: string): APIClass | undefined {
    return this.byName.get(name);
  }

  numberOf(cls: APIClass): number {
    return this.numbers.get(cls);
  }

  /** @param name from the addon */
  member(cls: APIClass, name: string): APIMember | undefined {
    return this.members.get(cls).get(name);
  }

  membersOf(cls: APIClass): Iterable<APIMember> {
    return this.members.get(cls).values();
  }

  isEnumValue(enumName: string, value: unknown): boolean {
    return (typeof value == "string" || typeof value == "number") &&
      !!this.enumValues.get(enumName)?.contains(value);
  }

  /** What the addon's runtime needs to build its proxies: per class number, the members and their kinds */
  describe(): { name: string, members: [string, APIMember["kind"], boolean][] }[] {
    return this.classes.map(cls => ({
      name: cls.name,
      members: [...this.membersOf(cls)].map(member =>
        [member.name, member.kind, member.kind != "method" && !!member.write?.length]),
    }));
  }
}
