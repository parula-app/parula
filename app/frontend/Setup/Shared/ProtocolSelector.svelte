<vbox class="protocol-selector">
  {#each protocols as protocol}
    <label class="protocol">
      <input type="radio" bind:group={selectedProtocol} value={protocol.protocolID} name="protocol" />
      <span class="name">{protocol.label}</span>
    </label>
  {/each}
</vbox>

<script lang="ts" context="module">
  export class ProtocolDescription {
    label: string;
    protocolID: string;
  }
</script>
<script lang="ts">
  /** in */
  export let protocols: ProtocolDescription[];
  /** in/out */
  export let selectedProtocol: string = protocols[0]?.protocolID;

  $: removeSelectionIfGone(protocols);
  function removeSelectionIfGone(protocols: ProtocolDescription[]) {
    if (!protocols.some(protocol => protocol.protocolID == selectedProtocol)) {
      selectedProtocol = null;
    }
  }
</script>

<style>
  .protocol-selector {
    margin-block-start: 6px;
    align-items: start;
    margin-inline-end: 32px;
    padding-block-start: 4px;
  }
  .protocol {
    padding: 2px 20px 2px 12px;
    margin: 2px;
  }
  .name {
    margin-inline-start: 8px;
  }
</style>
