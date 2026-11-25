<!-- The emails, files, contacts etc. of the topic -->
<vbox class="topic-links">
  {#if $emails.hasItems}
    <h3>{$t`Emails`}</h3>
    <!-- The message list needs a height.
      Without its keyboard shortcuts, because they work on the emails selected in the Mail app. -->
    <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
    <vbox class="emails" style="height: {Math.min($emails.length, 8) * (mailView == "vertical" ? 56 : 24) + 24}px"
      on:click={event => catchErrors(() => onOpenEMail(event))}
      on:keydown|capture|stopPropagation>
      {#if mailView == "widetable" || mailView == "3pane"}
        <TableMessageList messages={emails} bind:selectedMessage bind:selectedMessages />
      {:else}
        <VerticalMessageList messages={emails} bind:selectedMessage bind:selectedMessages />
      {/if}
    </vbox>
  {/if}
  {#if $files.hasItems}
    <h3>{$t`Files`}</h3>
    <!-- `Scroll` in the list needs a height -->
    <vbox class="files" style="height: {filesView == "gallery" ? 250 : Math.min($files.length, 8) * 24 + 40}px">
      {#if filesView == "gallery"}
        <Gallery {files} dirs={noDirs} />
      {:else}
        <FilesList {files} dirs={noDirs} />
      {/if}
    </vbox>
  {/if}
  {#each sections as section (section.type)}
    {#if section.links.length}
      <h3>{section.title}</h3>
      <vbox class="links">
        {#each section.links as link (link)}
          <TopicLinkRow {link} />
        {/each}
      </vbox>
    {/if}
  {/each}
</vbox>

<script lang="ts">
  import type { Topic } from "../../../logic/Topic/Topic";
  import { TopicLinkType, type TopicLink } from "../../../logic/Topic/Link/TopicLink";
  import { EMail } from "../../../logic/Mail/EMail";
  import { File } from "../../../logic/Files/File";
  import type { Directory } from "../../../logic/Files/Directory";
  import { openEMailMessage } from "../../Mail/open";
  import VerticalMessageList from "../../Mail/Vertical/VerticalMessageList.svelte";
  import TableMessageList from "../../Mail/3pane/TableMessageList.svelte";
  import FilesList from "../../Files/FilesList/FilesList.svelte";
  import Gallery from "../../Files/Gallery/Gallery.svelte";
  import TopicLinkRow from "./TopicLinkRow.svelte";
  import { getLocalStorage } from "../../Util/LocalStorage";
  import { catchErrors, showError } from "../../Util/error";
  import { gt, t } from "../../../l10n/l10n";
  import { ArrayColl } from "svelte-collections";
  import { tick } from "svelte";

  export let topic: Topic;

  /** The views that the user chose in the Mail and Files apps */
  const mailViewSetting = getLocalStorage("mail.view", "vertical");
  const filesViewSetting = getLocalStorage("files.view", "table");
  $: mailView = $mailViewSetting.value;
  $: filesView = $filesViewSetting.value;

  let emails = new ArrayColl<EMail>();
  let selectedMessage: EMail;
  let selectedMessages = new ArrayColl<EMail>();
  let files = new ArrayColl<File>();
  let noDirs = new ArrayColl<Directory>();
  let sections: { type: string, title: string, links: TopicLink[] }[] = [];

  $: links = topic.links;
  $: $links && load(topic)
    .catch(showError);
  async function load(loadingTopic: Topic) {
    await loadingTopic.findLinkTargets();
    if (loadingTopic != topic) {
      return;
    }
    let linksOfType = (type: TopicLinkType) => loadingTopic.links.contents.filter(link => link.target && link.type == type);
    emails.replaceAll(linksOfType(TopicLinkType.EMail).map(link => link.target as EMail));
    files.replaceAll(linksOfType(TopicLinkType.File).map(link => link.target as File));
    sections = [
      { type: TopicLinkType.Person, title: gt`Contacts`, links: linksOfType(TopicLinkType.Person) },
      { type: TopicLinkType.Event, title: gt`Events`, links: linksOfType(TopicLinkType.Event) },
      { type: TopicLinkType.ChatMessage, title: gt`Chat messages`, links: linksOfType(TopicLinkType.ChatMessage) },
      { type: "", title: gt`Not found`, links: loadingTopic.links.contents.filter(link => !link.target) },
    ];
  }

  async function onOpenEMail(event: MouseEvent) {
    if ((event.target as Element).closest("button")) {
      return; // e.g. the star of the email
    }
    await tick(); // the list selects the email first
    if (selectedMessage) {
      openEMailMessage(selectedMessage);
    }
  }
</script>

<style>
  .topic-links {
    margin-block: 24px 12px;
  }
  h3 {
    margin-block: 16px 4px;
  }
  .emails {
    border: 1px solid var(--border);
  }
</style>
