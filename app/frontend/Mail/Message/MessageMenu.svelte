<MenuItem
  onClick={reply}
  label={$t`Reply to author`}
  tooltip={$t`Reply to the person who sent this message`}
  icon={ReplyIcon} />
<MenuItem
  onClick={replyAll}
  label={$t`Reply to all`}
  tooltip={$t`Reply to all recipients of this message`}
  disabled={recipients.length <= 1 || message.bcc.hasItems && !message.outgoing}
  icon={ReplyAllIcon} />
<MenuItem
  onClick={forward}
  label={$t`Forward`}
  tooltip={$t`Send this message to somebody else`}
  icon={ForwardIcon} />
<MenuItem
  onClick={redirect}
  label={$t`Redirect`}
  tooltip={$t`Send this message to somebody else, who can reply to the original sender`}
  icon={RedirectIcon} />
{#if message.outgoing}
  <MenuItem
    onClick={editAsNew}
    label={$t`Edit as new`}
    tooltip={$t`Create a new message with the same content and recipients`}
    icon={EditAsNewIcon} />
{/if}
<MenuItem
  onClick={newToAll}
  label={$t`New topic`}
  tooltip={$t`Send a new, unrelated message to all recipients`}
  icon={NewAllIcon} />
<MenuItem
  onClick={deleteMessage}
  classes="danger"
  label={$t`Delete`}
  icon={TrashIcon} />
<MenuItem
  onClick={toggleSpam}
  classes={$message.isSpam ? "" : "danger"}
  label={$message.isSpam ? $t`Mark as not spam` : $t`Mark as spam`}
  tooltip={$message.isSpam ? $t`Treat this email as *not* spam` : $t`Treat this email as spam: Move it to the Spam folder, and train the spam filter`}
  icon={$message.isSpam ? NotSpamIcon : SpamIcon} />
<MenuItem
  onClick={translate}
  label={$t`Translate`}
  tooltip={$t`Use an online translation service to translate this message to your default language.`}
  icon={TranslateIcon} />
<MenuItem
  onClick={save}
  label={$t`Export as file`}
  tooltip={$t`Save this email to a file on your computer`}
  icon={SaveIcon} />
{#if printE}
  <MenuItem
    onClick={print}
    label={$t`Print`}
    tooltip={$t`Put ink on dead trees which were artificially made white. Save the trees!`}
    icon={PrintIcon} />
{/if}
<MenuItem
  onClick={showSource}
  label={$t`Show source`}
  tooltip={$t`Show the on-the-wire format of this message`}
  icon={SourceIcon} />
<MenuItem
  onClick={showDOMInspector}
  label={$t`Show DOM`}
  tooltip={$t`Show HTML email in the DOM Inspector of the Developer Tools`}
  icon={SourceIcon} />
<hbox bind:this={domE} />

<script lang="ts">
  import type { EMail } from "../../../logic/Mail/EMail";
  import { mailMustangApp } from "../MailMustangApp";
  import { getLocalStorage } from "../../Util/LocalStorage";
  import type Print from "./MessagePrint.svelte";
  import MenuItem from "../../Shared/Menu/MenuItem.svelte";
  import ReplyIcon from "lucide-svelte/icons/reply";
  import ReplyAllIcon from "lucide-svelte/icons/reply-all";
  import NewAllIcon from "lucide-svelte/icons/plus";
  import ForwardIcon from "lucide-svelte/icons/forward";
  import RedirectIcon from "lucide-svelte/icons/move-right";
  import EditAsNewIcon from "lucide-svelte/icons/iteration-ccw";
  import TrashIcon from "lucide-svelte/icons/trash-2";
  import SpamIcon from "lucide-svelte/icons/shield-x";
  import NotSpamIcon from "lucide-svelte/icons/shield-off";
  import TranslateIcon from "lucide-svelte/icons/languages";
  import SaveIcon from "lucide-svelte/icons/save";
  import PrintIcon from "lucide-svelte/icons/printer";
  import SourceIcon from "lucide-svelte/icons/code-xml";
  import { saveBlobAsFile } from "../../Util/util";
  import { showError } from "../../Util/error";
  import { NotImplemented } from "../../../logic/util/util";
  import { tick } from "svelte";
  import { t } from "../../../l10n/l10n";
  import { sanitize } from "../../../../lib/util/sanitizeDatatypes";

  export let message: EMail;
  export let printE: Print | null = null;

  $: recipients = message.allRecipients();

  function reply() {
    let reply = message.compose.replyToAuthor();
    mailMustangApp.writeMail(reply);
  }
  function replyAll() {
    let reply = message.compose.replyAll();
    mailMustangApp.writeMail(reply);
  }
  function newToAll() {
    let mail = message.compose.newToAll();
    mailMustangApp.writeMail(mail);
  }
  async function forward(event: MouseEvent) {
    let setting = getLocalStorage("mail.send.forward", "inline").value;
    let shift = !!event?.shiftKey;
    let forward: EMail;
    if (setting == "attachment" && !shift || setting == "inline" && shift) {
      forward = await message.compose.forwardAsAttachment();
    } else {
      forward = await message.compose.forwardInline();
    }
    mailMustangApp.writeMail(forward);
  }
  async function redirect() {
    let redirect = await message.compose.redirect();
    mailMustangApp.writeMail(redirect);
  }
  async function editAsNew() {
    let clone = await message.compose.editAsNew();
    mailMustangApp.writeMail(clone);
  }

  async function deleteMessage() {
    await message.deleteMessage();
    goToNextMessage();
  }
  async function toggleSpam() {
    await message.treatSpam(!message.isSpam);
    goToNextMessage();
  }

  function goToNextMessage() {
    message = message.nextMessage() ?? message;
  }

  async function save() {
    await message.loadMIME();
    let content = message.mime as Uint8Array<ArrayBuffer>;
    let filename = sanitize.filename(message.subject, "email") + ".eml";
    let file = new File([content], filename, { type: "message/rfc822" });
    await saveBlobAsFile(file);
  }

  async function print() {
    printE.print()
      .catch(showError);
  }

  function showSource() {
    let setting = getLocalStorage("mail.contentRendering", "html");
    setting.value = setting.value == "source" ? "html" : "source";
  }
  let domE: HTMLDivElement;
  async function showDOMInspector() {
    let setting = getLocalStorage("mail.contentRendering", "html");
    setting.value = "html";
    await tick(); // The <webview> reaches the DOM only after the update
    let messageE = domE.ownerDocument.querySelector(".message-body");
    let webviewE = messageE.querySelector("webview") as HTMLIFrameElement as any;
    webviewE.openDevTools();
  }
  function translate() {
    throw new NotImplemented();
  }
</script>
