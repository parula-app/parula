<vbox flex class="app-frame">
  <Route path="mail/*">
    <MailAppRoutes />
  </Route>
  <Route path="chat/*">
    <ChatRoutes />
  </Route>
  <Route path="contacts/*">
    <ContactsAppRoutes />
  </Route>
  <Route path="calendar/*">
    <CalendarRoutes />
  </Route>
  <Route path="files/*">
    <FilesAppRoutes />
  </Route>
  <Route path="meet/*">
    <MeetAppRoutes />
  </Route>
  <Route path="topic/*">
    <TopicRoutes />
  </Route>
  <Route path="webapp/*">
    <WebAppsRoutes />
  </Route>
  <Route path="settings/*">
    <SettingsRoutes />
  </Route>
  // #if [!WEBMAIL]
  <Route path="setup/*">
    <SetupRoutes />
  </Route>
  // #endif
  <Route path="login/">
    <OAuth2EmbeddedBrowser dialog={params?.dialog ?? requiredParam()} />
  </Route>
  <Route path="app-menu/">
    <AppMenu />
  </Route>
  <Route path="/">
    <!-- default, on app start-->
    <MailAppRoutes />
  </Route>
</vbox>

<script lang="ts">
  import AppMenu from "./AppMenuM/AppMenu.svelte";
  import MailAppRoutes from "../Mail/MailRoutes.svelte";
  import ChatRoutes from "../Chat/ChatRoutes.svelte";
  import ContactsAppRoutes from "../Contacts/ContactsRoutes.svelte";
  import FilesAppRoutes from "../Files/FilesRoutes.svelte";
  import CalendarRoutes from "../Calendar/CalendarRoutes.svelte";
  import MeetAppRoutes from "../Meet/MeetRoutes.svelte";
  import TopicRoutes from "../Topic/TopicRoutes.svelte";
  import WebAppsRoutes from "../WebApps/WebAppsRoutes.svelte";
  import SettingsRoutes from "../Settings/SettingsRoutes.svelte";
  // #if [!WEBMAIL]
  import SetupRoutes from "../Setup/SetupRoutes.svelte";
  // #endif
  import OAuth2EmbeddedBrowser from "../Shared/Auth/OAuth2EmbeddedBrowser.svelte";
  import { getParams } from "./selectedApp";
  import { requiredParam } from "../Util/route";
  import { Route, useLocation } from "svelte-navigator";

  $: location = useLocation();
  $: params = getParams($location?.state);
</script>
