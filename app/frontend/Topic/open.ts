import type { Topic } from "../../logic/Topic/Topic";
import { selectedTopic } from "./selected";
import { topicMustangApp } from "./TopicMustangApp";
import { openApp } from "../AppsBar/selectedApp";
import { AppWindow } from "../MainWindow/AppWindow";

export function openTopic(topic: Topic) {
  AppWindow.current().mainWindow.uiState(selectedTopic).set(topic);
  openApp(topicMustangApp, {});
}
