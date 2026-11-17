<vbox class="sml-calendar">
  <slot />
</vbox>

<style>
  .sml-calendar {
    height: 50vh;
    min-height: 360px;
    overflow-x: auto;
    font-size: var(--lo-font-size);
  }
  .sml-calendar :global(.meeting-time-poll),
  .sml-calendar :global(.book),
  .sml-calendar :global(.book-select) {
    margin: 0;
  }
  .sml-calendar :global(.list) {
    align-self: stretch;
    width: auto;
    margin-inline: 0 12px;
  }
  .sml-calendar :global(.splitter .right .list) {
    margin-inline: 12px 0;
  }
  .sml-calendar :global(.length > .label),
  .sml-calendar :global(.label.answers) {
    opacity: 100%;
    color: var(--lo-fg-secondary);
  }

  .sml-calendar :global(button.button:not(.plain)) {
    min-height: 28px;
    padding: 2px 10px;
    border-color: var(--lo-input-border);
    border-radius: var(--lo-radius-small);
  }
  .sml-calendar :global(button.button.plain) {
    border-radius: var(--lo-radius-small);
  }
  .sml-calendar :global(.length) {
    align-items: center;
  }
  .sml-calendar :global(.view-switcher) {
    align-items: start;
  }
  .sml-calendar :global(.island) {
    border-radius: var(--lo-radius-small);
  }
  .sml-calendar :global(.island button.button),
  .sml-calendar :global(.island button.button.selected) {
    margin-inline-end: 0;
    border-radius: 0;
  }
  .sml-calendar :global(.island button.button.selected) {
    box-shadow: inset 0 -2px 0 var(--lo-accent);
  }

  .sml-calendar :global(select) {
    height: 32px;
    padding: 0 8px;
    border: 1px solid var(--lo-input-border);
    border-radius: var(--lo-radius-small);
    background-color: var(--lo-input-bg);
    color: var(--lo-fg);
    font: inherit;
  }

  .sml-calendar :global(.options .date.header) {
    margin: 8px 0 2px 0;
    font-size: var(--lo-font-size-small);
  }
  .sml-calendar :global(.options .option) {
    min-height: 32px;
    margin: 0;
    padding-inline: 0;
    border-bottom: 1px solid var(--lo-divider);
    border-radius: 0;
    box-shadow: none;
    background-color: transparent;
    color: var(--lo-fg);
  }
  .sml-calendar :global(.options .option:hover) {
    background-color: var(--lo-hover-bg);
  }
  .sml-calendar :global(.options .start-time) {
    font-weight: normal;
  }
  .sml-calendar :global(.options .end-separator),
  .sml-calendar :global(.options .end-time) {
    opacity: 100%;
  }

  .sml-calendar :global(.date-range-header) {
    margin-block-end: 8px;
  }
  .sml-calendar :global(.date-range) {
    font-size: var(--lo-font-size-large);
  }
  .sml-calendar :global(.day-view-grid) {
    border-top: 1px solid var(--lo-divider);
  }
  .sml-calendar :global(.day-view-grid .header) {
    background-color: var(--lo-pane-bg);
  }
  .sml-calendar :global(.day-header),
  .sml-calendar :global(.day-column),
  .sml-calendar :global(.all-day-events .day) {
    border-top: none;
    border-left: 1px solid var(--lo-divider);
  }
  .sml-calendar :global(.all-day-events) {
    border-bottom: 1px solid var(--lo-divider);
  }
  .sml-calendar :global(.day-header .date) {
    font-weight: 600;
  }
  .sml-calendar :global(.day-header .weekday) {
    display: block;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .sml-calendar :global(.time.label) {
    color: var(--lo-fg-secondary);
    font-size: var(--lo-font-size-small);
    font-weight: normal;
  }
  .sml-calendar :global(.hour-slot) {
    background-image: none;
    border-bottom: 1px solid var(--lo-divider);
  }
  .sml-calendar :global(.hour-slot:hover) {
    background-color: var(--lo-hover-bg);
    color: var(--lo-fg);
  }

  .sml-calendar :global(.event .event:not(.unanswered):not(.cancelled)),
  .sml-calendar :global(.all-day-events .event:not(.unanswered):not(.cancelled)) {
    border: 1px solid color-mix(in srgb, var(--color, var(--account-color)) 45%, transparent);
    border-inline-start: 4px solid var(--color, var(--account-color));
    border-radius: 4px;
    background-color: color-mix(in srgb, var(--color, var(--account-color)) 22%, var(--lo-pane-bg));
    background-image: none;
    color: var(--lo-fg);
    opacity: 100%;
  }
  .sml-calendar :global(.event .event .time) {
    font-weight: normal;
  }
  .sml-calendar :global(.event .event .time),
  .sml-calendar :global(.event .event .title) {
    margin-block-start: 1px;
    margin-inline-start: 4px;
    font-size: inherit;
    line-height: 15px;
  }
  @container (height < 16px) {
    .sml-calendar :global(.event .event .time),
    .sml-calendar :global(.event .event .title) {
      font-size: clamp(8px, (100cqh - 2px) / 1.2, 1em);
      line-height: 1.2;
    }
  }
  @container (width < 5.5ch) {
    .sml-calendar :global(.event .event .time),
    .sml-calendar :global(.event .event .title) {
      font-size: clamp(8px, (100cqh - 2px) / 1.2, 10px);
      line-height: 1.2;
    }
  }
  .sml-calendar :global(.event-proposal) {
    margin: 0 2px 1px 0;
    border: 1px solid var(--lo-accent);
    border-radius: 4px;
    box-shadow: none;
    background-color: var(--lo-pane-bg);
    color: var(--lo-fg);
  }
  .sml-calendar :global(.hour-slot .event-proposal) {
    border-style: dashed;
    background-color: var(--lo-accent-tint);
  }
  .sml-calendar :global(.event-proposal .time) {
    font-size: var(--lo-font-size-small);
  }
  .sml-calendar :global(.event-proposal .toolbar) {
    border: 1px solid var(--lo-border);
    border-radius: var(--lo-radius-small);
    box-shadow: none;
    background-color: var(--lo-pane-bg);
  }
  .sml-calendar :global(.event-proposal button.button),
  .sml-calendar :global(.event-proposal button.button:not(.plain)) {
    min-height: 0;
    padding: 2px;
  }
  .sml-calendar :global(.event-proposal .toolbar button.button) {
    color: var(--lo-fg-secondary);
  }
</style>
