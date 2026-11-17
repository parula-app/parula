import type { ChatRoom } from "../../logic/Chat/ChatRoom";
import { selectedAccount, selectedRoom } from "./selected";
import { chatMustangApp } from "./ChatMustangApp";
import { goTo, openApp } from "../AppsBar/selectedApp";
import { AppWindow } from "../MainWindow/AppWindow";
import { appGlobal } from "../../logic/app";

export function openChatRoomFromOtherApp(room: ChatRoom) {
  let appWindow = AppWindow.current().mainWindow;
  appWindow.uiState(selectedRoom).set(room);
  appWindow.uiState(selectedAccount).set(room.account);
  if (appGlobal.isMobile) {
    goTo("/chat/room", { room });
  } else {
    openApp(chatMustangApp, {});
  }
}
