import { MustangApp } from "../AppsBar/MustangApp";
import topicIcon from '../asset/icon/appBar/topic.svg?raw';
import { gt } from "../../l10n/l10n";

export class TopicMustangApp extends MustangApp {
  id = "topic";
  name = gt`Topic`;
  icon = topicIcon;
  appURL = "/topic";
}

export const topicMustangApp = new TopicMustangApp();
