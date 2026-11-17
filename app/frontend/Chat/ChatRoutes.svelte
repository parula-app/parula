{#if appGlobal.isMobile}
  <Route path="room">
    <RoomM room={params?.room ?? $selectedRoom} />
  </Route>
  <Route path="person/:personID">
    <RoomM room={findChatForPerson(params?.person)} />
  </Route>
  <Route path="account/:accountID/persons" let:params={urlParams}>
    {$selectedAccount = params?.chatAccount ?? appGlobal.chatAccounts.find(ab => ab.id == urlParams.accountID) ?? requiredParam(), ""}
    <RoomsM />
  </Route>
  <Route path="search">
    <RoomsM doSearch={true} />
  </Route>
  <Route path="/">
    <RoomsM />
  </Route>
{:else}
  <Route path="/">
    <ChatAppD />
  </Route>
{/if}

<script lang="ts">
  import { ChatRoom } from "../../logic/Chat/ChatRoom";
  import { ChatPersonUID } from "../../logic/Chat/ChatPersonUID";
  import { Person } from "../../logic/Abstract/Person";
  import { selectedAccount, selectedRoom } from "./selected";
  import { appGlobal } from "../../logic/app";
  import ChatAppD from "./ChatAppD.svelte";
  import RoomsM from "./RoomsM.svelte";
  import RoomM from "./RoomM.svelte";
  import { getParams } from "../AppsBar/selectedApp";
  import { requiredParam } from "../Util/route";
  import { Route, useLocation } from "svelte-navigator";

  $: location = useLocation();
  $: params = getParams($location?.state);

  function findChatForPerson(person: Person): ChatRoom | null {
    if (!person) {
      return null;
    }
    for (let account of appGlobal.chatAccounts) {
      for (let room of account.rooms) {
        if (room.contact instanceof ChatPersonUID && room.contact.matchesPerson(person)) {
          return room;
        }
      }
    }
    return null;
  }
</script>
