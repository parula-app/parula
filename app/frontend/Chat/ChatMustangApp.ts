import { MustangApp } from "../AppsBar/MustangApp";
import chatIcon from '../asset/icon/appBar/chat.svg?raw';
import { gt } from "../../l10n/l10n";

export class ChatMustangApp extends MustangApp {
  id = "chat";
  get name() {
    return gt`Chat`;
  }
  icon = chatIcon;
  appURL = "/chat";
}

export const chatMustangApp = new ChatMustangApp();
