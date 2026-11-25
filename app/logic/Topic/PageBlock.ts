import { Paragraph, type PageContent } from "./PageContent";
import type { Topic } from "./Topic";

/** Neutral intermediate representation of a topic page's content.
 * Used to convert between the topic tree and any editor UI without coupling
 * the two. The UI converts to/from its own format; logic applies the blocks
 * to the topic tree. */

export type TextBlock    = { kind: "text";    html: string };
export type EmbedBlock   = { kind: "embed";   contentType: string; contentID: string };
export type HeadingBlock = { kind: "heading"; level: number; text: string; topicID: string | null };
export type PageBlock    = TextBlock | EmbedBlock | HeadingBlock;

/** Returns a flat list of blocks representing `topic`'s content and all
 * descendant topics (as heading blocks).
 * `registerEmbedded` is called for each non-paragraph item; the caller
 * assigns a session-scoped ID and stores the live object in its own registry. */
export function toPageBlocks(
  topic: Topic,
  registerEmbedded: (content: PageContent) => string,
  depth = 1,
): PageBlock[] {
  let blocks: PageBlock[] = [];
  for (let content of topic.content) {
    if (content instanceof Paragraph) {
      if (content.rawHTMLDangerous) {
        blocks.push({ kind: "text", html: content.rawHTMLDangerous });
      }
    } else {
      let id = registerEmbedded(content);
      blocks.push({ kind: "embed", contentType: content.contentType, contentID: id });
    }
  }
  let level = Math.min(depth, 6);
  for (let child of topic.children) {
    blocks.push({ kind: "heading", level, text: child.name, topicID: child.id });
    blocks.push(...toPageBlocks(child, registerEmbedded, depth + 1));
  }
  return blocks;
}

/** Builds a flat ID → Topic map for the entire subtree rooted at `topic`. */
function buildTopicIDMap(topic: Topic): Map<string, Topic> {
  let map = new Map<string, Topic>();
  function visit(t: Topic) {
    for (let child of t.children) {
      map.set(child.id, child);
      visit(child);
    }
  }
  visit(topic);
  return map;
}

/** Applies a flat list of page blocks back onto the topic tree.
 * Text blocks become Paragraphs, embed blocks restore embedded content via
 * `getEmbedded`, heading blocks find-or-create child Topics (matched by ID,
 * falling back to name), and child topics missing from the blocks are deleted. */
export async function applyPageBlocks(
  topic: Topic,
  blocks: PageBlock[],
  getEmbedded: (id: string) => PageContent | undefined | null,
): Promise<void> {
  // Track which topics were touched (need saving) and which were seen (must not be pruned).
  let topicsModified = new Set<Topic>();
  let seenChildTopics = new Set<Topic>();
  // processedParents: topics whose children we actively managed; stragglers will be deleted.
  let processedParents = new Set<Topic>([topic]);

  // Snapshot the full ID→Topic map before restructuring the tree so headings
  // that changed level (= moved to a different parent) are still findable by ID.
  let topicByID = buildTopicIDMap(topic);

  // topicStack mirrors the heading nesting; the top is always the active parent topic.
  let topicStack: Topic[] = [topic];
  topic.content.clear();

  for (let block of blocks) {
    let currentTopic = topicStack[topicStack.length - 1];

    if (block.kind === "text") {
      // Skip empty paragraphs the editor inserts as placeholder content.
      if (block.html.trim() && block.html !== "<p></p>") {
        let para = new Paragraph(currentTopic);
        para.rawHTMLDangerous = block.html;
        topicsModified.add(currentTopic);
      }

    } else if (block.kind === "embed") {
      let content = getEmbedded(block.contentID);
      if (content) {
        content.topic = currentTopic;
        currentTopic.content.add(content);
        topicsModified.add(currentTopic);
      }

    } else if (block.kind === "heading") {
      // Pop the stack until the top sits at the correct nesting depth.
      while (topicStack.length > block.level) {
        topicStack.pop();
      }
      let parent = topicStack[topicStack.length - 1];
      // Remember this parent so its children are pruned in the cleanup pass below.
      processedParents.add(parent);

      // Matching 1: By ID - survives renames and heading-level changes
      let child: Topic | undefined;
      if (block.topicID) {
        let found = topicByID.get(block.topicID);
        // Guard: skip if already consumed (duplicate ID from a not-yet-stripped paste).
        if (found && !seenChildTopics.has(found)) {
          child = found;
          if (child.parent !== parent) {
            // Heading changed level. move topic to its new parent in the tree.
            // Schedule the old parent for the cleanup pass so its orphaned children are pruned.
            let oldParent = child.parent;
            if (oldParent) {
              processedParents.add(oldParent);
              oldParent.children.remove(child);
            }
            child.parent = parent;
            parent.children.add(child);
          }
        }
      }

      // Matching 2: Fall back to name match - covers headings typed fresh by the user
      // Skip already-consumed topics so a same-name paste copy becomes its own new topic.
      if (!child) {
        child = [...parent.children].find(t => t.name === block.text && !seenChildTopics.has(t));
      }

      // Matching 3: nothing matched - create a brand-new child topic
      if (child) {
        child.name = block.text;
        child.content.clear();
      } else {
        child = await parent.newChild(block.text);
      }

      seenChildTopics.add(child);
      topicStack.push(child);
      topicsModified.add(child);
    }
  }

  // Delete any child of a managed parent that no longer appears in the document.
  for (let parent of processedParents) {
    for (let child of [...parent.children]) {
      if (!seenChildTopics.has(child)) {
        await child.deleteIt();
      }
    }
  }

  for (let t of topicsModified) {
    await t.save();
  }
}
