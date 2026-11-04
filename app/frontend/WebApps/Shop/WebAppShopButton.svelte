<vbox>
  <Clickable onClick={onSelect}>
    <vbox class="app" class:selected={app == selectedApp}>
      <vbox class="icon">
        <img src={app.icon} width="96" height="96" alt="" />
      </vbox>
      <vbox class="nameDescr" flex>
        <h2 class="app-name font-normal">{app.nameTranslated}</h2>
        <div class="description font-smallest">{app.descriptionTranslated}</div>
      </vbox>
      <hbox class="actions">
        {#if app.homepage}
          <a class="homepage font-smallest" href={app.homepage} target="_blank">{$t`Info`}</a>
        {/if}
        <hbox flex />
        <RoundButton
          label={$t`Add`}
          icon={AddIcon}
          onClick={onAdd}
          classes="add create {adding ? "hidden" : ""}"
          />
      </hbox>
      {#if $instances.hasItems}
        <vbox class="instances-separator" />
        <vbox class="instances">
          {#each $instances.each as iapp, i}
            <hbox class="instance">
              {#if iapp.account}
                <hbox class="account-name" flex>
                  {iapp.account.name}
                </hbox>
              {:else}
                <hbox class="account-name" flex>
                  {iapp.nameTranslated?.split(" ").pop() + " " + i}
                </hbox>
              {/if}
              <RoundButton
                label={$t`Remove`}
                icon={TrashIcon}
                onClick={() => onRemove(iapp)}
                classes="remove plain" border={false}
                />
            </hbox>
          {/each}
        </vbox>
      {/if}
    </vbox>
  </Clickable>
  {#if adding}
    <AddDialog {app} on:added={onAddDone} />
  {/if}
</vbox>

<script lang="ts">
  import { WebAppLoginType, type WebAppListed } from "../../../logic/WebApps/WebAppListed";
  import { selectedWebApp, showingWebApp, webAppsRunning } from "../Runner/WebAppsRunning";
  import { Account } from "../../../logic/Abstract/Account";
  import { appGlobal } from "../../../logic/app";
  import AddDialog from "./AddDialog.svelte";
  import RoundButton from "../../Shared/RoundButton.svelte";
  import Clickable from "../../Shared/Clickable.svelte";
  import AddIcon from "lucide-svelte/icons/plus";
  import TrashIcon from "lucide-svelte/icons/trash-2";
  import CircleIcon from "lucide-svelte/icons/circle";
  import { t } from "../../../l10n/l10n";

  export let app: WebAppListed;
  export let selectedApp: WebAppListed; /* in/out */

  /** Add dialog is open */
  let adding = false;

  function onSelect() {
    selectedApp = app;
  }

  $: myApps = appGlobal.webApps.myApps;
  $: instances = myApps.filterObservable(a => a.id == app.id);

  function onAdd() {
    if (app.loginType == WebAppLoginType.None) {
      myApps.add(app.instantiate());
      return;
    }
    adding = true;
  }
  function onAddDone() {
    adding = false;
  }
  function onRemove(app: WebAppListed) {
    myApps.remove(app);
    webAppsRunning.remove(app);
    if ($selectedWebApp == app) {
      $selectedWebApp = webAppsRunning.last;
    }
    if ($showingWebApp == app) {
      $showingWebApp = webAppsRunning.last;
    }
  }
</script>

<style>
  .app {
    border: 1px solid var(--border);
    border-radius: 3px;
    margin: 4px;
    padding: 12px;
    height: 330px;
    max-width: 192px;
    overflow-y: auto;
  }
  .icon {
    margin: 8px;
    align-self: center;
  }
  .nameDescr {
    overflow-y: auto;
    overflow-x: hidden;
  }
  .app-name {
    margin-block-start: 16px;
  }
  .actions {
    align-items: center;
    justify-content: end;
    flex-wrap: wrap;
  }
  .actions :global(button) {
    margin-inline-start: 8px;
    margin-block-start: 4px;
  }
  .actions :global(button.hidden) {
    visibility: hidden;
  }
  .instances-separator {
    border-top: 1px solid var(--border);
    margin-block-start: 16px;
    margin-block-end: 8px;
  }
  .instance {
    align-items: center;
  }
  .account-name {
    justify-items: center;
  }
  .instance :global(.no-account svg) {
    stroke-width: 4px;
  }
</style>
