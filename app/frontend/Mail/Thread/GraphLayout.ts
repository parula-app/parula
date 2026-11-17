import type { Node } from "./Node";

export interface NodeLayout {
  node: Node;
  /** Indent level: How deeply this msg is nested in the discussion */
  col: number;
  /** Position in the discussion. Each msg gets a row of its own. */
  row: number;
  x: number;
  y: number;
  /** Number of replies that are not shown, because they are nested too deeply.
   * Shown as e.g. "+20" next to this node. */
  hiddenReplies: number;
}

export interface Edge {
  /** SVG path `d` attribute */
  d: string;
  /** The msg that this line leads to is @see Node.isBold */
  isBold: boolean;
}

export interface Layout {
  positions: NodeLayout[];
  edges: Edge[];
  width: number;
  height: number;
}

export const kRadius = 18;
/** Distance between the centers of 2 msgs that follow each other */
export const kRowHeight = 52;
/** Distance between the centers of 2 indent levels */
export const kColWidth = 32;
/** Space around the outermost nodes, for the focus ring and the star */
export const kMargin = 26;
/** Room for the "+20" that stands for the replies which are not shown */
export const kHiddenRepliesWidth = 30;
/** Replies deeper than this are folded into a "+20", so that the bar stays narrow */
const kMaxCols = 4;

/**
 * Places the messages of a thread on a grid and connects them with lines.
 *
 * A reply is indented one level to the right. The last reply is not indented,
 * but continues directly below its parent, so that the main line of the
 * discussion reads straight down. Lines leave a msg at its bottom and enter
 * its replies at their top.
 *
 * @param root The first msg of the thread
 * @param horizontal The discussion runs to the right and replies are indented
 *   downwards (mobile), instead of the other way around (desktop).
 */
export function computeLayout(root: Node, horizontal = false): Layout {
  let positions: NodeLayout[] = [];
  layoutNodes(root, 0, 0, positions);
  for (let position of positions) {
    let screen = toScreen(logical(position), horizontal);
    position.x = screen.x;
    position.y = screen.y;
  }

  let lastCol = Math.max(...positions.map(position => position.col));
  let lastRow = Math.max(...positions.map(position => position.row));
  let hasHiddenReplies = positions.some(position => position.hiddenReplies);
  let size = toScreen({
    along: lastRow * kRowHeight + kMargin * 2,
    across: lastCol * kColWidth + kMargin * 2 + (hasHiddenReplies ? kHiddenRepliesWidth : 0),
  }, horizontal);
  return {
    positions,
    edges: buildEdges(positions, horizontal),
    width: size.x,
    height: size.y,
  };
}

/** Position of a msg, in px, along the direction in which the discussion runs,
 * and across it, in the direction in which replies are indented. */
interface Logical {
  along: number;
  across: number;
}

function logical(position: NodeLayout): Logical {
  return {
    along: kMargin + position.row * kRowHeight,
    across: kMargin + position.col * kColWidth,
  };
}

function toScreen(position: Logical, horizontal: boolean): { x: number, y: number } {
  return horizontal
    ? { x: position.along, y: position.across }
    : { x: position.across, y: position.along };
}

function layoutNodes(node: Node, col: number, row: number, results: NodeLayout[]): void {
  let position: NodeLayout = { node, col, row, x: 0, y: 0, hiddenReplies: 0 };
  results.push(position);

  let replies = node.children.contents;
  if (!replies.length) {
    return;
  }
  let canIndent = col + 1 < kMaxCols;
  let nextRow = row + 1;
  for (let reply of replies.slice(0, -1)) {
    if (canIndent) {
      layoutNodes(reply, col + 1, nextRow, results);
      nextRow += subtreeHeight(reply, col + 1);
    } else {
      position.hiddenReplies += countMessages(reply);
    }
  }
  // The last reply continues the line of its parent, in the same column
  layoutNodes(replies[replies.length - 1], col, nextRow, results);
}

/** Number of rows that this msg and its replies need.
 * That is the same as the number of msgs shown, because each msg gets its own row. */
function subtreeHeight(node: Node, col: number): number {
  let replies = node.children.contents;
  if (!replies.length) {
    return 1;
  }
  let rows = 1;
  if (col + 1 < kMaxCols) {
    for (let reply of replies.slice(0, -1)) {
      rows += subtreeHeight(reply, col + 1);
    }
  }
  return rows + subtreeHeight(replies[replies.length - 1], col);
}

/** Number of msgs in this subtree, including `node` itself */
function countMessages(node: Node): number {
  let count = 1;
  for (let reply of node.children) {
    count += countMessages(reply);
  }
  return count;
}

function buildEdges(positions: NodeLayout[], horizontal: boolean): Edge[] {
  let shown = new Map<Node, NodeLayout>();
  for (let position of positions) {
    shown.set(position.node, position);
  }

  let edges: Edge[] = [];
  for (let position of positions) {
    let replies = position.node.children.contents
      .map(reply => shown.get(reply))
      .filter(reply => !!reply); // the deeply nested ones are folded into "+20"
    if (!replies.length) {
      continue;
    }
    let lastReply = replies.pop();
    let parent = logical(position);
    let last = logical(lastReply);
    // Straight line down from the msg to its last reply. The other replies branch off it.
    edges.push({
      d: curve(
        { along: parent.along + kRadius, across: parent.across },
        { along: last.along - kRadius, across: parent.across },
        horizontal),
      isBold: lastReply.node.isBold,
    });
    for (let reply of replies) {
      let branch = logical(reply);
      edges.push({
        d: curve(
          { along: branch.along - kRowHeight + kRadius, across: parent.across },
          { along: branch.along - kRadius, across: branch.across },
          horizontal),
        isBold: reply.node.isBold,
      });
    }
  }
  return edges;
}

/** An "S" curve from the line of a msg over to one of its replies.
 * Both ends run parallel to the direction of the discussion, so that the line
 * leaves the msg at its bottom and enters the reply at its top.
 * When both are in the same column, this comes out as a straight line. */
function curve(from: Logical, to: Logical, horizontal: boolean): string {
  let middle = (from.along + to.along) / 2;
  let start = toScreen(from, horizontal);
  let bendAtParent = toScreen({ along: middle, across: from.across }, horizontal);
  let bendAtReply = toScreen({ along: middle, across: to.across }, horizontal);
  let end = toScreen(to, horizontal);
  return `M ${start.x} ${start.y} C ${bendAtParent.x} ${bendAtParent.y}, ${bendAtReply.x} ${bendAtReply.y}, ${end.x} ${end.y}`;
}
