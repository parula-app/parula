<RibbonGroup label={$t`Polls *=> Ribbon group to insert polls and bookings into the email`}>
  {#if account}
    {#each types as type}
      <RibbonButton label={label(type)} icon={icon(type)}
        tooltip={tooltip(type)}
        disabled={$mail.sml ? $t`The message already has a poll. Remove it first.` : !identity}
        onClick={() => insert(type)} />
    {/each}
  {:else}
    <RibbonButton label={$t`Create SML account`} icon={PollIcon}
      disabled={!identity}
      onClick={onRegister} />
  {/if}
</RibbonGroup>

<script lang="ts">
  import type { EMail } from "../../../logic/Mail/EMail";
  import type { SMLData } from "../../../logic/Mail/SML/SMLData";
  import type { MailIdentity } from "../../../logic/Mail/MailIdentity";
  import { createPoll, createMeetingTimePoll, createBookMe } from "../../../logic/Mail/SML/SMLCreateKind";
  import { SMLHTTPAccount } from "../../../logic/Mail/SML/SMLHTTPAccount";
  import { showError } from "../../../frontend/Util/error";
  import RibbonGroup from "../../Shared/Ribbon/RibbonGroup.svelte";
  import RibbonButton from "../../Shared/Ribbon/RibbonButton.svelte";
  import PollIcon from "lucide-svelte/icons/list-checks";
  import SchedulingPollIcon from "lucide-svelte/icons/calendar-clock";
  import BookingsIcon from "lucide-svelte/icons/calendar-check";
  import { assert } from "../../../logic/util/util";
  import { t } from "../../../l10n/l10n";

  export let mail: EMail;

  const types = ["SimplePoll", "MeetingTimePoll", "BookMe"];
  $: identity = mail.identity;
  $: account = $identity?.smlAccount;

  function tooltip(type: string): string {
    switch (type) {
      case "SimplePoll": return $t`Insert a poll: recipients choose one of the options`;
      case "MeetingTimePoll": return $t`Insert a scheduling poll: recipients vote for the meeting times that suit them`;
      case "BookMe": return $t`Offer meeting times: the recipient books one of them with you`;
      default: return "";
    }
  }

  function insert(type: string) {
    mail.sml = create(type, identity);
  }

  function create(type: string, identity: MailIdentity): SMLData {
    switch (type) {
      case "SimplePoll": return createPoll(identity);
      case "MeetingTimePoll": return createMeetingTimePoll(identity);
      case "BookMe": return createBookMe(identity);
      default: return null;
    }
  }

  // <copied from="../../../frontend/Mail/SML/SMLAddKinds.svelte" onRegister() registerSMLHTTP()>
  function onRegister() {
    registerSMLHTTP()
      .catch(showError);
  }

  async function registerSMLHTTP() {
    assert(!account, "Already have an account");
    account = await SMLHTTPAccount.getOrCreateAccount(identity);
    if (!account.isLoggedIn) {
      await account.login(); // waits for email, so often takes minutes or hangs entirely
    }
  }
  // </copied>

  /* <copied from="SMLComposer.svelte"> */
  function label(type: string): string {
    switch (type) {
      case "SimplePoll": return $t`Poll`;
      case "MeetingTimePoll": return $t`Scheduling Poll`;
      case "BookMe": return $t`Bookings *=> Meeting times in the email that the recipient can book`;
      default: return "";
    }
  }
  /* </copied> */

  /* <copied from="../SML/SMLDisplayKinds.svelte"> */
  function icon(type: string): ConstructorOfATypedSvelteComponent {
    switch (type) {
      case "MeetingTimePoll": return SchedulingPollIcon;
      case "BookMe": return BookingsIcon;
      default: return PollIcon;
    }
  }
  /* </copied> */
</script>
