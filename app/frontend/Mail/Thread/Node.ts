import { ArrayColl } from "svelte-collections";

export class Node {
  /** Describes the node for screen readers, and as tooltip */
  name: string = "";
  /** any valid foo in `<img src="foo">` */
  icon: string | null = null;
  /** Used when `icon` is null */
  placeholder: string | null = null;
  /** Background of the node, as CSS color. Identifies the person. */
  color: string | null = null;
  isBold: boolean = false;
  isFocus: boolean = false;
  isStarred: boolean = false;
  readonly children = new ArrayColl<Node>();
}
