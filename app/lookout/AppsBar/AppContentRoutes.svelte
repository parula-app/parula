<!-- <copied from="../../frontend/AppsBar/AppContentRoutes.svelte"> -->
<vbox flex class="app-frame">
  <Route path="mail/*">
    <MailRoutes />
  </Route>
  <Route path="chat/*">
    <vbox flex class="frontend-panes">
      <ChatRoutes />
    </vbox>
  </Route>
  <Route path="contacts/*">
    <ContactsRoutes />
  </Route>
  <Route path="calendar/*">
    <CalendarRoutes />
  </Route>
  <Route path="files/*">
    <FilesApp>
      <vbox flex class="frontend-panes">
        <FilesRoutes />
      </vbox>
    </FilesApp>
  </Route>
  <Route path="meet/*">
    <vbox flex class="frontend-page">
      <MeetRoutes />
    </vbox>
  </Route>
  <Route path="topic/*">
    <vbox flex class="frontend-page">
      <TopicRoutes />
    </vbox>
  </Route>
  <Route path="webapp/*">
    <vbox flex class="frontend-panes">
      <WebAppsRoutes />
    </vbox>
  </Route>
  <Route path="settings/*">
    <vbox flex class="frontend-panes">
      <SettingsRoutes />
    </vbox>
  </Route>
  // #if [!WEBMAIL]
  <Route path="setup/*">
    <SetupRoutes />
  </Route>
  // #endif
  <Route path="login/">
    <vbox flex class="frontend-page">
      <OAuth2EmbeddedBrowser dialog={params?.dialog ?? requiredParam()} />
    </vbox>
  </Route>
  <Route path="app-menu/">
    <vbox flex class="frontend-page">
      <AppMenu />
    </vbox>
  </Route>
  <Route path="/">
    <MailRoutes />
  </Route>
</vbox>
<!-- </copied> -->

<script lang="ts">
  import MailRoutes from "../Mail/MailRoutes.svelte";
  import CalendarRoutes from "../Calendar/CalendarRoutes.svelte";
  import ContactsRoutes from "../Contacts/ContactsRoutes.svelte";
  import FilesApp from "../Files/FilesApp.svelte";
  import AppMenu from "../../frontend/AppsBar/AppMenuM/AppMenu.svelte";
  import ChatRoutes from "../../frontend/Chat/ChatRoutes.svelte";
  import FilesRoutes from "../../frontend/Files/FilesRoutes.svelte";
  import MeetRoutes from "../../frontend/Meet/MeetRoutes.svelte";
  import TopicRoutes from "../../frontend/Topic/TopicRoutes.svelte";
  import WebAppsRoutes from "../../frontend/WebApps/WebAppsRoutes.svelte";
  import SettingsRoutes from "../../frontend/Settings/SettingsRoutes.svelte";
  // #if [!WEBMAIL]
  import SetupRoutes from "../Setup/SetupRoutes.svelte";
  // #endif
  import OAuth2EmbeddedBrowser from "../../frontend/Shared/Auth/OAuth2EmbeddedBrowser.svelte";
  import { getParams } from "../../frontend/AppsBar/selectedApp";
  import { requiredParam } from "../../frontend/Util/route";
  import { Route, useLocation } from "svelte-navigator";

  $: location = useLocation();
  $: params = getParams($location?.state);
</script>

<style>
  .app-frame {
    min-width: 0;
    min-height: 0;
  }
  .frontend-page {
    min-width: 0;
    min-height: 0;
    margin: 4px 8px 8px 8px;
    background-color: var(--lo-pane-bg);
    border-radius: var(--lo-radius);
    box-shadow: var(--lo-shadow-card);
    overflow: hidden;
  }
  .frontend-panes {
    min-width: 0;
    min-height: 0;
    margin: 4px 4px 0 4px;
  }
</style>
