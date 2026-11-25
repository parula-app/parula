<vbox class="topic-page-container" flex>
  <hbox class="toolbar">
    <HTMLEditorToolbar {editor} />
    <hbox class="buttons">
      <RoundButton
        label={$t`Save`}
        icon={SaveIcon}
        onClick={onSave}
        border={false}
        iconSize="24px"
        />
      <ButtonMenu bind:isMenuOpen={isMenuOpen}>
        <RoundButton
          slot="control"
          tooltip={$t`More actions`}
          icon={MenuIcon}
          onClick={() => isMenuOpen = !isMenuOpen}
          classes="plain"
          border={false}
          iconSize="24px"
          />
        <MenuItem
          label={$t`Export as Markdown text`}
          tooltip={$t`Save this topic as MarkDown file`}
          icon={ExportIcon}
          onClick={() => onExport("text/markdown")} />
        <MenuItem
          label={$t`Export as HTML`}
          tooltip={$t`Save this topic as an HTML file`}
          icon={ExportIcon}
          onClick={() => onExport("text/html")} />
        <MenuItem
          classes="danger"
          label={$t`Delete topic`}
          tooltip={$t`Delete topic ${topic.name} including all contents`}
          icon={TrashIcon}
          onClick={onDelete} />
      </ButtonMenu>
    </hbox>
  </hbox>
  <Scroll>
    <Paper>
      <vbox class="topic-page" flex>
        <hbox class="title">
          <input type="text" bind:value={topic.name}
            on:keydown={event => catchErrors(() => onKeyEnter(event, onTitleEnter))}/>
        </hbox>
        <vbox class="content" flex>
          <HTMLEditor bind:html={pageHTML} bind:editor {extraExtensions}
            on:change={onChange} />
        </vbox>
        <TopicLinks {topic} />
      </vbox>
    </Paper>
  </Scroll>
</vbox>

<script lang="ts">
  import type { PageContent } from "../../../logic/Topic/PageContent";
  import { Topic } from "../../../logic/Topic/Topic";
  import { toPageBlocks, applyPageBlocks, type PageBlock } from "../../../logic/Topic/PageBlock";
  import { TopicHeadingID } from "./TopicHeadingID";
  import { EmbeddedContent, type EmbeddedRenderer } from "../../Shared/Editor/EmbeddedContent";
  import HTMLEditor from "../../Shared/Editor/HTMLEditor.svelte";
  import HTMLEditorToolbar from "../../Shared/Editor/HTMLEditorToolbar.svelte";
  import ImageEdit from "./ImageEdit.svelte";
  import TopicLinks from "./TopicLinks.svelte";
  import Paper from "../../Shared/Paper.svelte";
  import Scroll from "../../Shared/Scroll.svelte";
  import ButtonMenu from "../../Shared/Menu/ButtonMenu.svelte";
  import MenuItem from "../../Shared/Menu/MenuItem.svelte";
  import RoundButton from "../../Shared/RoundButton.svelte";
  import SaveIcon from "lucide-svelte/icons/save";
  import MenuIcon from "lucide-svelte/icons/ellipsis";
  import ExportIcon from "lucide-svelte/icons/file-down";
  import TrashIcon from "lucide-svelte/icons/trash-2";
  import { onKeyEnter, saveBlobAsFile } from "../../Util/util";
  import { catchErrors } from "../../Util/error";
  import { gt, t } from "../../../l10n/l10n";
  import type { Editor } from "@tiptap/core";
  import { DOMSerializer } from "@tiptap/pm/model";
  import debounce from "lodash/debounce";
  import { mount, unmount } from "svelte";

  export let topic: Topic;

  let editor: Editor;
  let isMenuOpen = false;

  // Maps contentID (stable UUID) → live PageContent object for this editing session
  let contentRegistry = new Map<string, PageContent>();

  let imageRenderer: EmbeddedRenderer = (target, content, deleteNode) => {
    let instance = mount(ImageEdit, {
      target,
      props: { topic: content.topic, image: content, onDelete: deleteNode },
    });
    return { destroy: () => unmount(instance) };
  };

  // Configured once; getContent closes over the stable Map reference so it
  // sees updated entries after topic navigation triggers a registry rebuild.
  let extraExtensions = [
    EmbeddedContent.configure({
      getContent: (id: string) => contentRegistry.get(id) ?? null,
      renderers: { image: imageRenderer },
    }),
    TopicHeadingID,
  ];

  let pageHTML: string;
  $: topic, reload();
  function reload() {
    contentRegistry.clear();
    pageHTML = blocksToHTML(toPageBlocks(topic, (content) => {
      let id = crypto.randomUUID();
      contentRegistry.set(id, content);
      return id;
    }));
  }

  /** Converts neutral PageBlocks to the TipTap-specific HTML the editor parses. */
  function blocksToHTML(blocks: PageBlock[]): string {
    let html = "";
    for (let block of blocks) {
      if (block.kind === "text") {
        html += block.html;
      } else if (block.kind === "embed") {
        html += `<div data-type="embedded-content" data-content-type="${block.contentType}" data-content-id="${block.contentID}"></div>`;
      } else if (block.kind === "heading") {
        let idAttr = block.topicID ? ` data-topic-id="${block.topicID}"` : "";
        html += `<h${block.level}${idAttr}>${escapeHTML(block.text)}</h${block.level}>`;
      }
    }
    return html || "<p></p>";
  }

  function escapeHTML(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  async function onExport(mimeType: string) {
    await saveBlobAsFile(topic.toFile(mimeType));
  }

  async function onTitleEnter() {
    editor.commands.focus();
    await topic.save();
  }

  async function onSave() {
    let blocks = editorToBlocks();
    await applyPageBlocks(topic, blocks, (id) => contentRegistry.get(id));
    await topic.save();
  }

  const saveDebounced = debounce(() => onSave(), 1000);
  // Auto-save
  function onChange() {
    saveDebounced();
  }

  /** Converts the current TipTap document to neutral PageBlocks. */
  function editorToBlocks(): PageBlock[] {
    let serializer = DOMSerializer.fromSchema(editor.schema);
    let blocks: PageBlock[] = [];
    // Consecutive plain nodes (paragraphs etc.) are accumulated into a single text block.
    let htmlAccum = "";

    function flushText() {
      if (htmlAccum) {
        blocks.push({ kind: "text", html: htmlAccum });
        htmlAccum = "";
      }
    }

    editor.state.doc.forEach((node) => {
      if (node.type.name === "embedded-content") {
        flushText();
        blocks.push({ kind: "embed", contentType: node.attrs.contentType, contentID: node.attrs.contentID });
      } else if (node.type.name === "heading") {
        flushText();
        if (node.textContent) {
          blocks.push({ kind: "heading", level: node.attrs.level as number, text: node.textContent, topicID: node.attrs.topicID ?? null });
        }
      } else {
        // Serialize to HTML and accumulate until interrupted by a heading or embed.
        let fragment = serializer.serializeNode(node);
        let div = document.createElement("div");
        div.appendChild(fragment);
        htmlAccum += div.innerHTML;
      }
    });
    flushText();
    return blocks;
  }

  async function onDelete() {
    if (topic.content.hasItems) {
      let ok = confirm(gt`Do you want to delete topic ${topic.name}, including the page and all its contents?`);
      if (!ok) {
        return;
      }
    }
    let parent = topic.parent;
    await topic.deleteIt();
    topic = parent;
  }
</script>

<style>
  .topic-page-container {
    margin-block-end: 4px;
    position: relative;
  }
  .toolbar {
    background-color: var(--leftbar-bg);
    color: var(--leftbar-fg);
    padding-block-end: 2px;
    justify-content: end;
  }
  .toolbar .buttons {
    align-items: center;
    justify-content: center;
    margin-inline-start: 24px;
    margin-inline-end: 4px;
  }
  .topic-page {
    margin-inline: 24px 12px;
    margin-block-start: 12px;
  }
  .title input {
    margin-block-start: 0px;
    margin-block-end: 24px;
    margin-inline-end: 16px;
    font-size: 48px;
    font-weight: bold;
  }
  .content {
    min-height: 10em;
  }
</style>
