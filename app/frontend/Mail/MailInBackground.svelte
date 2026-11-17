<svelte:window on:url-mailto|capture={(event) => catchErrors(() => onMailto(event.url))} />

<script lang="ts">
  import { newMailListener } from "./NotifyNewMail";
  import { mailMustangApp } from "./MailMustangApp";
  import { openFileInternally } from "../Files/open";
  import { bringAppToFront } from "../AppsBar/selectedApp";
  import { selectedFolder } from "./Selected";
  import { appGlobal } from "../../logic/app";
  import { catchErrors } from "../Util/error";
  import { assert, sleep, type URLString } from "../../logic/util/util";
  import { t } from "../../l10n/l10n";
  import { onMount } from "svelte";

  onMount(() => catchErrors(newMailListener));

  $: emailAccounts = appGlobal.emailAccounts;
  $: startupArgs = $emailAccounts.hasItems ? appGlobal.remoteApp?.startupArgs : null;
  $: catchErrors(() => startupArgs?.url ? runURL($startupArgs.url) : null);
  $: catchErrors(() => startupArgs?.file ? openFile($startupArgs.file) : null);

  async function runURL(url: URLString) {
    if (!url) {
      return;
    }
    let urlObj = new URL(url);
    if (urlObj.protocol == "mailto:") {
      startupArgs.handled();
      await onMailto(url);
      bringAppToFront();
    }
  }

  async function onMailto(url: URLString) {
    let account = emailAccounts.first;
    assert(account, $t`Please set up an email account before sending mail`);
    await waitForStartup();
    let mail = account.newEMailFrom();
    mail.compose.populateFromMailtoURL(url);
    mailMustangApp.writeMail(mail);
  }

  async function openFile(file: string) {
    if (file.endsWith(".eml")) {
      startupArgs.handled();
      let mime = await appGlobal.remoteApp.readFile(file);

      await waitForStartup();
      await openFileInternally(mime, "message/rfc822");
      bringAppToFront();
    }
  }

  /** `newEMailFrom()` and `AllFolders.newEMail()` need the Sent folder of an account,
   * so wait until we read the folders. `$selectedFolder` tells us that we have them. */
  async function waitForStartup(): Promise<boolean> {
    if ($selectedFolder) {
      return false;
    }
    let counter = 0;
    while (!$selectedFolder && counter++ < 100) {
      await sleep(0.1);
    }
    return true;
  }
</script>
