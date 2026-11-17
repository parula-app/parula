/**
 * Lets DOMPurify work in happy-dom like in browsers.
 * Import this before anything that loads DOMPurify, because DOMPurify keeps
 * the functions that it gets from the DOM when it loads.
 *
 * Without this, `sanitizeHTML()` throws in happy-dom, or leaves most of the HTML
 * unsanitized. A test would then not show what the sanitizer does in the app.
 */

/* `nodeName`:
 * DOMPurify reads it with the getter of `Node.prototype`, so that a mail cannot
 * fake it. In browsers, that is the only getter. happy-dom has one per node class,
 * and the one of `Node.prototype` returns "" for elements and text, so DOMPurify
 * removes `<html>` and all text.
 * Make the getter of `Node.prototype` call the one of the node's class. */
const nodeNameGetter = Object.getOwnPropertyDescriptor(Node.prototype, "nodeName").get;
Object.defineProperty(Node.prototype, "nodeName", {
  configurable: true,
  get() {
    for (let proto = Object.getPrototypeOf(this); proto && proto != Node.prototype; proto = Object.getPrototypeOf(proto)) {
      let getter = Object.getOwnPropertyDescriptor(proto, "nodeName")?.get;
      if (getter) {
        return getter.call(this);
      }
    }
    return nodeNameGetter.call(this);
  },
});

/* `createNodeIterator()`:
 * DOMPurify walks the HTML with a `NodeIterator` and removes the current node when
 * it's not allowed. In browsers, the iterator then continues after the node that was
 * before it (DOM standard: "pre-removing steps"). happy-dom's iterator continues from
 * the removed node, which has no parent anymore, so it stops, and the rest of the
 * HTML is not sanitized. */
class StandardNodeIterator {
  readonly root: Node;
  readonly whatToShow: number;
  readonly filter: NodeFilter | null;
  /** The node that `nextNode()` returned last */
  protected current: Node | null = null;
  /** The node that was before `current` when we returned it */
  protected before: Node | null = null;

  constructor(root: Node, whatToShow = 0xFFFFFFFF, filter: NodeFilter | null = null) {
    this.root = root;
    this.whatToShow = whatToShow;
    this.filter = filter;
  }

  nextNode(): Node | null {
    let node = this.current;
    if (node && !this.root.contains(node)) {
      node = this.before; // `current` was removed
    }
    for (node = node ? this.following(node) : this.root; node; node = this.following(node)) {
      if (this.accepts(node)) {
        this.before = this.preceding(node);
        this.current = node;
        return node;
      }
    }
    return null;
  }

  protected accepts(node: Node): boolean {
    if (!(this.whatToShow & (1 << (node.nodeType - 1)))) {
      return false;
    }
    let result = typeof this.filter == "function" ? this.filter(node) : this.filter?.acceptNode(node);
    return result === undefined || result == NodeFilter.FILTER_ACCEPT;
  }

  /** The next node in tree order, inside `root` */
  protected following(node: Node): Node | null {
    if (node.firstChild) {
      return node.firstChild;
    }
    for (; node && node != this.root; node = node.parentNode) {
      if (node.nextSibling) {
        return node.nextSibling;
      }
    }
    return null;
  }

  /** The previous node in tree order, inside `root` */
  protected preceding(node: Node): Node | null {
    if (node == this.root) {
      return null;
    }
    let previous = node.previousSibling;
    if (!previous) {
      return node.parentNode;
    }
    while (previous.lastChild) {
      previous = previous.lastChild;
    }
    return previous;
  }
}

// The global `Document` of happy-dom is not the class of `document`, so find the class that has the function
let documentPrototype = Object.getPrototypeOf(document);
while (!Object.prototype.hasOwnProperty.call(documentPrototype, "createNodeIterator")) {
  documentPrototype = Object.getPrototypeOf(documentPrototype);
}
documentPrototype.createNodeIterator = function (root: Node, whatToShow?: number, filter?: NodeFilter | null) {
  return new StandardNodeIterator(root, whatToShow, filter) as any as NodeIterator;
};

/* Loading:
 * In browsers, a document from `DOMParser`, like the one that DOMPurify works on,
 * loads nothing. happy-dom loads `<iframe>`s and follows `<meta http-equiv="refresh">`,
 * so a test would fetch from the servers in its HTML. */
const settings = (window as any).happyDOM.settings;
settings.disableIframePageLoading = true;
settings.navigation.disableMainFrameNavigation = true;
settings.navigation.disableChildFrameNavigation = true;
settings.navigation.disableChildPageNavigation = true;
