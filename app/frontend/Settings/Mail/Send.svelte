<HeaderGroupBox>
  <hbox slot="header">
    {$t`Quote`}
  </hbox>
  <vbox>
    <hbox class="subtitle">{$t`When replying:`}</hbox>

    <hbox class="quote">
      <vbox>
        <label class="radio">
          <input type="radio" value="below" bind:group={quoteSetting.value} />
          {$t`Quote below, Reply above`}
        </label>
        <vbox class="illustration-paper">
          <Paper>
            <div class="illustration">
              <p>{$t`At 8:00 *=> Meet at 8 AM`}</p>
              <p>{$t`${`Ben Bucksch`} wrote:`}</p>
              <blockquote type="cite">
                {$t`When do we meet?`}
              </blockquote>
            </div>
          </Paper>
        </vbox>
      </vbox>

      <vbox>
        <label class="radio">
          <input type="radio" value="above" bind:group={quoteSetting.value} />
          {$t`Quote above, Reply below`}
        </label>
        <vbox class="illustration-paper">
          <Paper>
            <div class="illustration">
              <p>{$t`${`Ben Bucksch`} wrote: *=> Mail quote attribution line`}</p>
              <blockquote type="cite">
                {$t`When do we meet?`}
              </blockquote>
              <p>{$t`At 8:00 *=> Meet at 8 AM`}</p>
            </div>
          </Paper>
        </vbox>
      </vbox>

      <vbox>
        <label class="radio">
          <input type="radio" value="none" bind:group={quoteSetting.value} />
          {$t`Do not quote`}
        </label>
        <hbox />
      </vbox>
    </hbox>

    <hbox class="strip-signatures">
      <input type="checkbox" bind:checked={stripSignaturesSetting.value} id="strip-signatures"
        disabled={quoteSetting.value == "none"} />
      <label for="strip-signatures">
        {$t`Remove signatures from the quoted message`}
      </label>
    </hbox>
  </vbox>
</HeaderGroupBox>

<HeaderGroupBox>
  <hbox slot="header">
    {$t`Formatting`}
  </hbox>
  <hbox class="format">
    <vbox>
      <label class="radio">
        <input type="radio" value="html" bind:group={formatSetting.value} />
        {$t`Send as HTML and Plaintext`}
      </label>
      <vbox class="illustration-paper">
        <Paper>
          <div class="illustration">
            <blockquote type="cite">
              {@html $t`<strong>When</strong> and <strong>where</strong> do we meet?`}
            </blockquote>
            <ul>
              <li>{$t`At 8:00 *=> Meet at 8 AM`}</li>
              <li>{@html $t`I'll come by <em>your</em> office`}</li>
            </ul>
          </div>
        </Paper>
      </vbox>
    </vbox>

    <vbox>
      <label class="radio">
        <input type="radio" value="plaintext" bind:group={formatSetting.value} />
        {$t`Send as Plaintext only`}
      </label>
      <vbox class="illustration-paper">
        <Paper>
          <div class="illustration">
            <pre>&gt; {$t`*When* and *where* do we meet?`}

* {$t`At 8:00 *=> Meet at 8 AM`}
* {$t`I'll come by /your/ office`}</pre>
          </div>
        </Paper>
      </vbox>
    </vbox>
  </hbox>
</HeaderGroupBox>

<HeaderGroupBox>
  <hbox slot="header">
    {$t`Composition`}
  </hbox>
  <hbox class="composition">
    <input type="checkbox" bind:checked={spellcheckEnabledSetting.value} name="spellcheck" />
    <label class="spellcheck" for="spellcheck">
      {$t`Spell check`}
    </label>
  </hbox>
</HeaderGroupBox>

<script lang="ts">
  import HeaderGroupBox from "../../Shared/HeaderGroupBox.svelte";
  import { getLocalStorage } from "../../Util/LocalStorage";
  import { t } from "../../../l10n/l10n";
  import Paper from "../../Shared/Paper.svelte";

  let formatSetting = getLocalStorage("mail.send.format", "html");
  let quoteSetting = getLocalStorage("mail.send.quote", "below");
  let stripSignaturesSetting = getLocalStorage("mail.send.quote.stripSignatures", true);
  let spellcheckEnabledSetting = getLocalStorage("mail.send.spellcheck.enabled", false);
</script>

<style>
  .subtitle {
    margin-block-end: 16px;
  }
  hbox.quote,
  hbox.format {
    flex-wrap: wrap;
    gap: 16px;
  }
  .quote img {
    margin: 12px 48px 24px 28px;
  }
  .format img {
    margin: 16px 32px 24px 28px;
  }
  .strip-signatures {
    align-items: center;
    margin-block-start: 16px;
  }
  label.spellcheck {
    text-decoration: underline;
    text-decoration-style: wavy;
    text-decoration-color: red;
  }
  .radio {
    align-items: center;
  }
  input[type="checkbox"] {
    margin-inline-end: 12px;
  }
  label {
    margin-inline-start: 8px;
  }
  .illustration-paper {
    margin-block-start: 8px;
    margin-inline-start: 8px;
    padding-inline-start: 8px;
  }

  .illustration {
    margin-block-start: -4px;
    margin-inline-start: 8px;
    padding-inline-start: 8px;
    margin-inline-end: 16px;
  }
  .illustration blockquote[type=cite] {
    border-inline-start: 3px solid #20AE9E;
    padding-inline-start: 20px;
    margin-inline-start: 0px;
    margin-inline-end: 0px;
  }
  .illustration pre {
    margin-block-start: 16px;
    font-size: 14px;
  }
  .illustration ul {
    padding-inline-start: 24px;
  }
  .illustration strong {
    font-weight: 800;
  }
</style>
