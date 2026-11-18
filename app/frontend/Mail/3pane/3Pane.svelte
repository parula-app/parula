<Splitter name="mail.3pane.folders" initialRightRatio={4}>
  <LeftPane {accounts} {folders}
    bind:selectedAccount bind:selectedFolder bind:selectedFolders bind:searchMessages
    bind:activeTab={$selectedSearchTab}
    slot="left" />
  <SplitterBidirectional {horizontal}
    name={horizontal ? "mail.3pane.msgs" : "mail.widetable.msgs"}
    initialSecondRatio={horizontal ? 2 : 1}
    slot="right">
    <vbox flex class="message-list-pane" slot="first">
      <PaymentBar account={selectedAccount} showWhenNoAccount={false} />
      <AutoResponderBar account={selectedAccount} />
      <FolderHeader folder={selectedFolder} {searchMessages} />
      <TableMessageList {messages} bind:selectedMessage bind:selectedMessages />
      {#if !horizontal}
        <FolderFooter folder={selectedFolder} bind:searchMessages />
      {/if}
    </vbox>
    <vbox flex class="message-display-pane" slot="second">
      {#if selectedMessage}
        <MessageDisplay message={selectedMessage} />
      {:else}
        <StartPage />
      {/if}
    </vbox>
  </SplitterBidirectional>
</Splitter>

<script lang="ts">
  import type { MailAccount } from "../../../logic/Mail/MailAccount";
  import type { Folder } from "../../../logic/Mail/Folder";
  import type { EMail } from "../../../logic/Mail/EMail";
  import { selectedSearchTab } from "../Selected";
  import TableMessageList from "./TableMessageList.svelte";
  import LeftPane from "../LeftPane/LeftPane.svelte";
  import FolderFooter from "../LeftPane/FolderFooter.svelte";
  import FolderHeader from "../LeftPane/FolderHeader.svelte";
  import AutoResponderBar from "../AutoResponderBar.svelte";
  import MessageDisplay from "../Message/MessageDisplay.svelte";
  import StartPage from "../StartPage.svelte";
  // #if [PROPRIETARY]
  import PaymentBar from "../../Settings/License/Banner/PaymentBar.svelte";
  // #else
  import PaymentBar from "../../Shared/Empty.svelte";
  // #endif
  import Splitter from "../../Shared/Splitter.svelte";
  import SplitterBidirectional from "../../Shared/SplitterBidirectional.svelte";
  import type { ArrayColl, Collection } from 'svelte-collections';

  export let horizontal: boolean = true;
  export let accounts: Collection<MailAccount>; /** in */
  export let messages: ArrayColl<EMail>; /** in */
  export let folders: Collection<Folder>; /** in */
  export let searchMessages: ArrayColl<EMail> | null; /** out */
  export let selectedAccount: MailAccount; /** in/out */
  export let selectedFolder: Folder; /** in/out */
  export let selectedMessage: EMail; /** in/out */
  export let selectedMessages: ArrayColl<EMail>; /** in/out */
  let selectedFolders: ArrayColl<Folder>;
</script>

<style>
  .message-list-pane,
  .message-display-pane {
    background-color: var(--main-bg);
    color: var(--main-fg);
  }
  .message-display-pane {
    flex: 2 0 0;
  }
</style>
