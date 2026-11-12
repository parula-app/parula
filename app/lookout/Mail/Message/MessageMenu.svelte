{#if single}
  <MenuItem label={$t`Quick Print`} icon={PrintIcon} shortCutInfo={$t`Ctrl+P *=> Keyboard shortcut`}
    onClick={() => { $printMessage = single; }} />
  <MenuDivider />
  <MenuItem label={$t`Reply`} icon={ReplyIcon} shortCutInfo={$t`Ctrl+R *=> Keyboard shortcut`}
    onClick={() => MessageActions.respond(single, single.compose.replyToAuthor())} />
  <MenuItem label={$t`Reply All`} icon={ReplyAllIcon} shortCutInfo={$t`Ctrl+Shift+R *=> Keyboard shortcut`}
    disabled={!(single.allRecipients().length > 1 && !(single.bcc.hasItems && !single.outgoing)) && $t`There are no other recipients`}
    onClick={() => MessageActions.respond(single, single.compose.replyAll())} />
  <MenuItem label={$t`Forward`} icon={ForwardIcon} shortCutInfo={$t`Ctrl+F *=> Keyboard shortcut`}
    onClick={event => MessageActions.forward(single, event as MouseEvent)} />
  <MenuDivider />
{/if}
{#if allRead}
  <MenuItem label={$t`Mark as Unread`} icon={UnreadIcon} shortCutInfo={$t`Ctrl+U *=> Keyboard shortcut`}
    onClick={async () => { await Promise.all(messages.contents.map(message => message.markRead(false))); }} />
{:else}
  <MenuItem label={$t`Mark as Read`} icon={ReadIcon} shortCutInfo={$t`Ctrl+Alt+U *=> Keyboard shortcut`}
    onClick={async () => { await Promise.all(messages.contents.map(message => message.markRead(true))); }} />
{/if}
<SubMenu label={$t`Categorize *=> Assign a category to the selected emails`} icon={CategorizeIcon}>
  <CategorizeMenuItems messages={messages.contents} />
</SubMenu>
<SubMenu label={$t`Follow Up *=> Flag the selected emails for follow-up`} icon={FlagIcon}>
  <FollowUpMenuItems messages={messages.contents} />
</SubMenu>
<MenuDivider />
{#if single}
  <SubMenu label={$t`Find Related *=> Find emails related to the selected email`} icon={FindRelatedIcon}>
    <FindRelatedMenuItems message={single} />
  </SubMenu>
  <SubMenu label={$t`Rules *=> Criteria after which emails should be sorted`} icon={RulesIcon}>
    <RulesMenuItems message={single} account={single.folder?.account} />
  </SubMenu>
{/if}
<SubMenu label={$t`Move`} icon={MoveIcon}>
  <MoveMenuItems messages={messages.contents} />
</SubMenu>
<MenuDivider />
<SubMenu label={$t`Junk *=> Menu to mark the selected emails as junk or not junk`} icon={JunkIcon}>
  <JunkMenuItems messages={messages.contents} />
</SubMenu>
<MenuItem label={$t`Delete`} icon={DeleteIcon} shortCutInfo={$t`Del *=> Delete key`}
  onClick={async () => { await Promise.all(messages.contents.map(message => message.deleteMessage())); }} />
<MenuItem label={$t`Archive`} icon={ArchiveIcon} shortCutInfo={$t`Backspace *=> Backspace key`}
  onClick={() => MessageActions.archive(messages.contents)} />
{#if single}
  <MenuDivider />
  <MenuItem label={$t`Save As…`} icon={SaveIcon}
    onClick={() => MessageActions.saveAs(single)} />
  <MenuItem label={$contentRendering.value == "source" ? $t`View Message` : $t`View Source`} icon={SourceIcon}
    onClick={() => { $contentRendering.value = $contentRendering.value == "source" ? "html" : "source"; }} />
{/if}

<script lang="ts">
  import type { EMail } from "../../../logic/Mail/EMail";
  import { MessageActions } from "../MessageActions";
  import SubMenu from "../../Shared/Menu/SubMenu.svelte";
  import FollowUpMenuItems from "./FollowUpMenuItems.svelte";
  import JunkMenuItems from "./JunkMenuItems.svelte";
  import CategorizeMenuItems from "./CategorizeMenuItems.svelte";
  import MoveMenuItems from "./MoveMenuItems.svelte";
  import RulesMenuItems from "../Rules/RulesMenuItems.svelte";
  import FindRelatedMenuItems from "./FindRelatedMenuItems.svelte";
  import MenuItem from "../../Shared/Menu/MenuItem.svelte";
  import MenuDivider from "../../Shared/Menu/MenuDivider.svelte";
  import ReplyIcon from "lucide-svelte/icons/reply";
  import ReplyAllIcon from "lucide-svelte/icons/reply-all";
  import ForwardIcon from "lucide-svelte/icons/forward";
  import ReadIcon from "lucide-svelte/icons/mail-open";
  import UnreadIcon from "lucide-svelte/icons/mail";
  import CategorizeIcon from "lucide-svelte/icons/tag";
  import FlagIcon from "lucide-svelte/icons/flag";
  import FindRelatedIcon from "lucide-svelte/icons/text-search";
  import RulesIcon from "lucide-svelte/icons/list-filter";
  import MoveIcon from "lucide-svelte/icons/folder-input";
  import DeleteIcon from "lucide-svelte/icons/trash-2";
  import ArchiveIcon from "lucide-svelte/icons/archive";
  import JunkIcon from "lucide-svelte/icons/shield-x";
  import PrintIcon from "lucide-svelte/icons/printer";
  import { printMessage } from "../Selected";
  import SaveIcon from "lucide-svelte/icons/save";
  import SourceIcon from "lucide-svelte/icons/code-xml";
  import { getLocalStorage } from "../../../frontend/Util/LocalStorage";
  import type { Collection } from "svelte-collections";
  import { t } from "../../../l10n/l10n";

  export let messages: Collection<EMail>;

  const contentRendering = getLocalStorage<string>("mail.contentRendering", "html");

  $: single = messages.length == 1 ? messages.first : null;
  $: allRead = messages.hasItems && messages.contents.every(message => message.isRead);
</script>
