import { Node } from "./Node";
import type { EMail } from "../../../logic/Mail/EMail";
import { consistentColor } from "../../../logic/Abstract/personColor";
import { gt } from "../../../l10n/l10n";
import type { Collection } from "svelte-collections";

/** One email in the thread graph. Shows who wrote it. @see Graph.svelte */
export class ThreadNode extends Node {
  readonly message: EMail;

  /** @param selected The msg that the user is reading right now */
  constructor(message: EMail, selected: EMail | null) {
    super();
    this.message = message;
    let author = message.from;
    this.placeholder = author.name || author.emailAddress;
    this.icon = author.findPerson()?.picture ?? null;
    this.color = consistentColor(author.emailAddress);
    this.isBold = !message.isRead;
    this.isFocus = message == selected;
    this.isStarred = message.isStarred;

    let states: string[] = [];
    if (this.isBold) {
      states.push(gt`unread`);
    }
    if (this.isStarred) {
      states.push(gt`starred`);
    }
    this.name = states.length
      ? `${this.placeholder} (${states.join(", ")})`
      : this.placeholder;
  }

  /**
   * Builds the reply tree of a thread, using `EMail.inReplyTo`.
   *
   * @param messages All msgs of the thread, in any order
   * @param selected The msg that the user is reading right now
   * @returns All msgs as nodes, sorted by date, earliest first.
   *   The first entry is the msg that started the thread, and the root of the tree.
   */
  static buildTree(messages: Collection<EMail>, selected: EMail | null): ThreadNode[] {
    let nodes = messages.contents
      .sort((a, b) => (a.sent?.getTime() ?? 0) - (b.sent?.getTime() ?? 0))
      .map(message => new ThreadNode(message, selected));

    // Filled while we walk, so that a msg can be a reply only to an earlier msg.
    // Otherwise, mails that name each other in `In-Reply-To` would form a cycle.
    let byMessageID = new Map<string, ThreadNode>();
    let root: ThreadNode | null = null;
    for (let node of nodes) {
      let repliedTo = byMessageID.get(node.message.inReplyTo);
      if (repliedTo) {
        repliedTo.children.add(node);
      } else if (root) {
        // We don't have the msg that this one replies to, e.g. it was deleted,
        // or the sender's mail app didn't set `In-Reply-To`.
        // The thread ID says that it belongs here, so show it as a reply to the first msg.
        root.children.add(node);
      } else {
        root = node;
      }
      if (node.message.messageID) {
        byMessageID.set(node.message.messageID, node);
      }
    }
    return nodes;
  }
}
