<div class="setup">
  <label class="field">
    <span>Server</span>
    <input type="url" bind:value={serverURL} />
  </label>
  <label class="field">
    <span>Username</span>
    <input type="text" bind:value={username} />
  </label>
  <label class="field">
    <span>Password, if not the one that you entered before</span>
    <input type="password" bind:value={password} />
  </label>
</div>

<script lang="ts">
  let serverURL = "https://json-mail.example.com";
  let username = "";
  let password = "";

  // The app takes the last values when the user continues
  $: username && mustang.protocols.setupAccount({ name: "JSON Mail " + username, username, password: password || undefined, serverURL });
</script>

<style>
  .setup {
    display: grid;
    gap: 12px;
    padding: 4px 0;
    color: var(--fg);
  }
  .field {
    display: grid;
    gap: 4px;
  }
  .field input {
    font: inherit;
    padding: 4px 8px;
  }
</style>
