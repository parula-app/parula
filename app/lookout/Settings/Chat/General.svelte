<OptionsPage icon={ChatIcon} description={$t`Change how you chat with other people`}>
  <OptionsSection title={$t`Message arrival`}>
    <OptionsRow icon={ArrivalIcon}>
      <hbox>{$t`When new chat messages arrive`}</hbox>
      <Checkbox label={$t`Play a sound`} checked={$notificationsSetting.value.includes("sound")}
        on:change={event => onNotification("sound", event.detail)} />
      <Checkbox label={$t`Display a Desktop Alert`} checked={$notificationsSetting.value.includes("popup")}
        on:change={event => onNotification("popup", event.detail)} />
    </OptionsRow>
  </OptionsSection>
</OptionsPage>

<script lang="ts">
  import { getLocalStorage } from "../../../frontend/Util/LocalStorage";
  import OptionsPage from "../Shared/OptionsPage.svelte";
  import OptionsSection from "../Shared/OptionsSection.svelte";
  import OptionsRow from "../Shared/OptionsRow.svelte";
  import Checkbox from "../../Shared/Form/Checkbox.svelte";
  import ChatIcon from "lucide-svelte/icons/message-circle";
  import ArrivalIcon from "lucide-svelte/icons/bell";
  import { t } from "../../../l10n/l10n";

  // <copied from="../../../frontend/Settings/Chat/Notifications.svelte">
  const notificationsSetting = getLocalStorage<string[]>("notifications.chat", ["popup"]);
  // </copied>

  function onNotification(kind: string, isOn: boolean) {
    let kinds = notificationsSetting.value.filter(entry => entry != kind);
    notificationsSetting.value = isOn ? [ ...kinds, kind ] : kinds;
  }
</script>
