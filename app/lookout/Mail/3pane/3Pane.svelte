<hbox flex class="panes">
  {#if $folderPane.value == FolderPaneMode.Minimized}
    <FolderPaneMinimized name={$selectedFolder ? FolderTreeActions.displayName($selectedFolder) : ""}
      on:expand={() => { folderPane.value = FolderPaneMode.Normal; }} />
  {/if}
  <Splitter name="lookout.mail.folderPane" initialRightRatio={5} leftMinWidth={180} rightMinWidth={480}
    hasLeft={$folderPane.value == FolderPaneMode.Normal || !$folderPane.value}>
    <LeftPane {accounts} bind:selectedAccount bind:selectedFolder slot="left" />
    <hbox flex class="main" slot="right">
      <hbox flex class="reading-pane-layout">
        <SplitterBidirectional horizontal={position == "bottom"}
          hasSecond={position == "right" || position == "bottom"}
          name={position == "bottom" ? "lookout.mail.readingPane.bottom" : "lookout.mail.readingPane.right"}
          initialSecondRatio={position == "bottom" ? 1.4 : 1.6}
          firstMinPx={position == "bottom" ? 160 : 300}
          secondMinPx={position == "bottom" ? 200 : 320}>
          <hbox flex class="part list" slot="first"
            class:top={position == "bottom"}
            class:single={position != "right" && position != "bottom"}>
            <vbox flex class="message-list-pane lo-card">
              <FolderHeader folder={selectedFolder} {selectedMessages} bind:searchMessages {isSearchResult} />
              <TableMessageList bind:this={messageList}
                {messages}
                folder={selectedFolder}
                {selectedMessages}
                bind:selectedMessage
                {showFolder}
                {highlight}
                {isLoading} />
              {#if hasMoreResults && $messages.hasItems}
                <hbox class="more-results">
                  <span>{$t`Showing recent results…`}</span>
                  <button type="button" class="more-link" on:click={() => dispatch("moreresults")}>{$t`More *=> Show more search results`}</button>
                </hbox>
              {/if}
            </vbox>
          </hbox>
          <hbox flex class="part reading" slot="second"
            class:right={position == "right"}
            class:bottom={position == "bottom"}>
            {#if selectedMessage && $selectedMessages.length <= 1}
              <MessageDisplay message={selectedMessage} />
            {:else}
              <vbox flex class="reading-pane-placeholder lo-card">
                {#if $selectedMessages.length > 1}
                  <MultipleIcon size={56} strokeWidth={1} />
                  <span class="placeholder-title">{$t`${$selectedMessages.length} items selected`}</span>
                {:else}
                  <ReadIcon size={56} strokeWidth={1} />
                  <span class="placeholder-title">{$t`Select an item to read`}</span>
                  <span class="placeholder-hint">{$t`Nothing is selected`}</span>
                {/if}
              </vbox>
            {/if}
          </hbox>
        </SplitterBidirectional>
      </hbox>
      {#if $toDoBar.value?.length}
        <ToDoBar parts={$toDoBar.value} />
      {/if}
    </hbox>
  </Splitter>
</hbox>

<script lang="ts" context="module">
  export type ReadingPanePosition = "right" | "bottom" | "off";
</script>

<script lang="ts">
  import type { EMail } from "../../../logic/Mail/EMail";
  import type { Folder } from "../../../logic/Mail/Folder";
  import type { MailAccount } from "../../../logic/Mail/MailAccount";
  import { FolderTreeActions } from "../LeftPane/FolderTreeActions";
  import LeftPane, { FolderPaneMode } from "../LeftPane/LeftPane.svelte";
  import FolderPaneMinimized from "../../Shared/FolderPaneMinimized.svelte";
  import FolderHeader from "../LeftPane/FolderHeader.svelte";
  import TableMessageList from "./TableMessageList.svelte";
  import MessageDisplay from "../Message/MessageDisplay.svelte";
  import ToDoBar, { type ToDoBarPart } from "../ToDoBar/ToDoBar.svelte";
  import Splitter from "../../../frontend/Shared/Splitter.svelte";
  import SplitterBidirectional from "../../../frontend/Shared/SplitterBidirectional.svelte";
  import { getLocalStorage } from "../../../frontend/Util/LocalStorage";
  import ReadIcon from "lucide-svelte/icons/mail-open";
  import MultipleIcon from "lucide-svelte/icons/mails";
  import { t } from "../../../l10n/l10n";
  import type { ArrayColl, Collection } from "svelte-collections";
  import { createEventDispatcher } from "svelte";

  export let accounts: Collection<MailAccount>;
  export let messages: Collection<EMail>;
  export let selectedAccount: MailAccount | null;
  export let selectedFolder: Folder | null;
  export let selectedMessage: EMail | null;
  export let selectedMessages: ArrayColl<EMail>;
  export let searchMessages: Collection<EMail> | null = null;
  export let isSearchResult = false;
  export let showFolder = false;
  export let highlight: string | null = null;
  export let isLoading = false;
  export let hasMoreResults = false;
  export let messageList: TableMessageList = null;

  const dispatch = createEventDispatcher<{ moreresults: void }>();

  const readingPane = getLocalStorage<ReadingPanePosition>("lookout.mail.readingPane", "right");
  const folderPane = getLocalStorage<FolderPaneMode>("lookout.mail.folderPane", FolderPaneMode.Normal);
  const toDoBar = getLocalStorage<ToDoBarPart[]>("lookout.mail.toDoBar", []);
  $: position = $readingPane.value;
</script>

<style>
  .panes {
    min-height: 0;
    min-width: 0;
  }
  .main {
    min-width: 0;
    min-height: 0;
  }
  /* <copied to="../../Calendar/CalendarApp.svelte"> */
  .reading-pane-layout {
    min-width: 0;
    min-height: 0;
  }
  .reading-pane-layout > :global(.splitter) {
    flex: 1 0 0;
    min-width: 0;
  }
  .part {
    min-width: 0;
    min-height: 0;
    height: 100%;
    box-sizing: border-box;
  }
  .list {
    padding: 0 4px 8px 0;
  }
  .list.single {
    padding-inline-end: 8px;
  }
  .list.top {
    padding: 0 8px 4px 0;
  }
  .reading.right {
    padding: 0 8px 8px 4px;
  }
  .reading.bottom {
    padding: 4px 8px 8px 0;
  }
  .part :global(> *) {
    flex: 1 0 0;
  }
  /* </copied> */
  .message-list-pane {
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }
  .more-results {
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 6px 12px;
    border-top: 1px solid var(--lo-divider);
    color: var(--lo-fg-secondary);
    font-size: var(--lo-font-size-small);
  }
  .more-link {
    padding: 0;
    border: none;
    background: none;
    color: var(--lo-accent-text);
    font: inherit;
    text-decoration: underline;
    cursor: pointer;
  }
  .reading-pane-placeholder {
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    align-items: center;
    justify-content: center;
    gap: 8px;
    color: var(--lo-fg-secondary);
  }
  .reading-pane-placeholder :global(svg) {
    color: var(--lo-fg-disabled);
  }
  .placeholder-title {
    color: var(--lo-fg);
    font-size: 16px;
    font-weight: 600;
  }
</style>
