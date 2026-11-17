<hbox class="get-mail {status}">
  <RoundButton
    label={folder?.account?.fatalError?.message ?? $t`Get mail`}
    icon={
      status == Status.Fetching ? FetchingIcon :
      status == Status.New ? NewIcon :
      status == Status.Error ? ErrorIcon :
      status == Status.Done ? DoneIcon :
      status == Status.Login ? LoginIcon :
      DownloadIcon
    }
    classes="small"
    {iconSize}
    padding="0px"
    disabled={!folder?.account || status != Status.Waiting}
    onClick={getMail}
    />
</hbox>

<script lang="ts">
  import type { Folder } from "../../../logic/Mail/Folder";
  import { appGlobal } from "../../../logic/app";
  import RoundButton from "../../Shared/RoundButton.svelte";
  import DownloadIcon from "lucide-svelte/icons/refresh-cw";
  import FetchingIcon from "lucide-svelte/icons/arrow-big-down-dash";
  import DoneIcon from "lucide-svelte/icons/check";
  import NewIcon from "lucide-svelte/icons/sparkle";
  import LoginIcon from "lucide-svelte/icons/key-round";
  import ErrorIcon from "lucide-svelte/icons/server-crash";
  import { showError } from "../../Util/error";
  import { sleep } from "../../../logic/util/util";
  import { t } from "../../../l10n/l10n";

  export let folder: Folder; /* in */
  export let iconSize = appGlobal.isMobile ? "24px" : "12px";

  enum Status {
    Waiting = "waiting",
    Login = "login",
    Fetching = "fetching",
    New = "new",
    Error = "error",
    Done = "done",
  };
  let status = Status.Waiting;

  async function getMail() {
    try {
      if (status != Status.Waiting) {
        return;
      }
      let account = folder.account;
      if (!account.isLoggedIn) {
        status = Status.Login;
        await account.loginAndStartup(true);
      }
      status = Status.Fetching;
      await folder.getNewMessages();
      status = folder.countNewArrived ? Status.New : Status.Done;
      await sleep(2);
      status = Status.Waiting;
    } catch (ex) {
      showError(ex);
      status = Status.Error;
      await sleep(2);
      status = Status.Waiting;
    }
  }
</script>

<style>
  .get-mail.new :global(svg) {
    color: orange;
    stroke-width: 3px;
  }
  .get-mail.done :global(svg) {
    color: green;
    stroke-width: 4px;
  }
  .get-mail.fetching :global(svg) {
    stroke-width: 2px;
    animation: down 1.5s ease 0s infinite normal ;
  }
  @keyframes down {
    0% {
      transform: translateY(-3px);
    }
    80% {
      transform: translateY(3px);
    }
    100% {
      transform: translateY(-3px);
    }
  }
</style>
