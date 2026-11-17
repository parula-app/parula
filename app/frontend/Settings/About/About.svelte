<vbox class="app-logo">
  <Icon data={logo} size="20px" />
</vbox>
<h1>{appName} {appVersion}</h1>

<div>
  <T msg={$t`Copyright 2024 Ben Bucksch, #, and other contributors`}>
    <a href="{siteRoot}" target="_blank">{appName == "Parula" || appName == "Lookout" ? "Beonex GmbH" : "Mustang GmbH"}</a>
  </T>
</div>

<vbox class="update">
  <Update />
</vbox>

<script lang="ts">
  import { appName, appVersion, siteRoot } from '../../../logic/build';
  import Update from './Update.svelte';
  import Icon from 'svelte-icon/Icon.svelte';
  import T from '../../../l10n/T.svelte';
  import logo from '../../asset/icon/general/logo.svg?raw';
  import { t } from '../../../l10n/l10n';
</script>

<style>
  .update {
    margin-block-start: 24px;
  }
</style>
