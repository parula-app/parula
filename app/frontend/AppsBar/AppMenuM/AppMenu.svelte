<Clickable onClick={onClose}>
  <vbox class="app-menu" flex>
    <hbox class="top">
      <vbox class="left" flex>
        <!--<WorkspaceDropDown />-->
      </vbox>
      <vbox class="center" flex>
        <hbox class="date font-small">
          {getFormattedDateString(new Date(), { weekday: "short", day: "2-digit", month: "short" })}
        </hbox>
        <hbox class="time">
          {getTimeString(new Date())}
        </hbox>
      </vbox>
      <vbox class="right" flex />
    </hbox>
    <hbox flex />
    <!--<RecentPersons />-->
    <hbox flex />
    <grid class="apps">
      <!-- each app must add exactly 5 elements -->
      <TopAppMenu />
      <!--<WebAppsAppMenu />-->
      <FilesAppMenu />
      <CalendarAppMenu />
      <MeetAppMenu />
      <ChatAppMenu />
      <MailAppMenu />
      <ContactsAppMenu />
      <BottomAppMenu />
    </grid>
  </vbox>
</Clickable>
<AppMenuBarM />

<script lang="ts">
  import { getDateString, getFormattedDateString, getTimeString } from "../../../logic/util/date";
  import TopAppMenu from "./TopAppMenu.svelte";
  import WebAppsAppMenu from "./Apps/WebAppsAppMenu.svelte";
  import FilesAppMenu from "./Apps/FilesAppMenu.svelte";
  import CalendarAppMenu from "./Apps/CalendarAppMenu.svelte";
  import MeetAppMenu from "./Apps/MeetAppMenu.svelte";
  import ChatAppMenu from "./Apps/ChatAppMenu.svelte";
  import MailAppMenu from "./Apps/MailAppMenu.svelte";
  import ContactsAppMenu from "./Apps/ContactsAppMenu.svelte";
  import BottomAppMenu from "./BottomAppMenu.svelte";
  import AppMenuBarM from "./AppMenuBarM.svelte";
  import RecentPersons from "./RecentPersons.svelte";
  import Clickable from "../../Shared/Clickable.svelte";
  import { goBack } from "../selectedApp";

  function onClose() {
    goBack();
  }
</script>

<style>
  :global(.content) .app-menu {
    background-color: transparent;
  }
  .app-menu {
    align-items: center;
  }
  grid {
    grid-template-columns: auto auto auto auto auto;
    align-items: center;
    justify-items: center;
    margin-block-end: 12px;

    width: 100%;
    max-width: 500px;
  }
  grid :global(hbox),
  grid :global(> button) {
    align-items: center;
    justify-content: center;
  }
  grid :global(.button) {
    box-shadow: -1px 0px 1px 0px rgba(22, 12, 39, 15%); /* #160C27 */
  }
  grid :global(.center-bar) {
    padding-block: 18px;
    padding-inline: 16px;
  }
  .app-menu :global(.app-button.contacts) {
    padding-block-end: 0px;
  }

  .top .center {
    align-items: center;
  }
  .time {
    font-size: 30px;
    font-weight: 500;
  }
  .date {
    opacity: 50%;
    width: max-content;
    margin-block-start: 32px;
  }
</style>
