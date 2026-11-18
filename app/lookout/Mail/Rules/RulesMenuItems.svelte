<MenuItem label={senderName ? $t`Always Move Messages From: ${senderName}` : $t`Always Move Messages From…`}
  icon={AlwaysMoveIcon}
  disabled={(!message && $t`Select a message first`) ||
    (!message.from?.findPerson() && $t`The sender is not in your address book`)}
  onClick={() => { $openAlwaysMove = message; }} />
<MenuItem label={$t`Create Rule…`} icon={CreateRuleIcon}
  disabled={!message && $t`Select a message first`}
  onClick={() => goTo("/mail/rules/create", { message })} />
<MenuItem label={$t`Manage Rules & Alerts…`} icon={ManageRulesIcon}
  disabled={!account && $t`Select a folder of an account first`}
  onClick={() => goTo("/mail/rules", { account })} />

<script lang="ts">
  import type { EMail } from "../../../logic/Mail/EMail";
  import type { MailAccount } from "../../../logic/Mail/MailAccount";
  import { openAlwaysMove } from "../Selected";
  import MenuItem from "../../Shared/Menu/MenuItem.svelte";
  import AlwaysMoveIcon from "lucide-svelte/icons/folder-input";
  import CreateRuleIcon from "lucide-svelte/icons/list-plus";
  import ManageRulesIcon from "lucide-svelte/icons/list-filter";
  import { t } from "../../../l10n/l10n";
  import { goTo } from "../../../frontend/AppsBar/selectedApp";

  export let message: EMail | null;
  export let account: MailAccount | null;

  $: senderName = message?.from?.name || message?.from?.emailAddress || "";
</script>
