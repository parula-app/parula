import { TopicLink, TopicLinkType } from "./TopicLink";
import { EMailLink } from "./EMailLink";
import { PersonLink } from "./PersonLink";
import { EventLink } from "./EventLink";
import { ChatMessageLink } from "./ChatMessageLink";
import { FileLink } from "./FileLink";
import type { Topic, LinkTarget } from "../Topic";
import { appGlobal } from "../../app";
import { NotSupported, ensureArray, getOwnProperty } from "../../util/util";
import { gt } from "../../../l10n/l10n";
import type { Collection } from "svelte-collections";

const kLinkClasses: Record<TopicLinkType, typeof TopicLink> = {
  [TopicLinkType.EMail]: EMailLink,
  [TopicLinkType.Person]: PersonLink,
  [TopicLinkType.Event]: EventLink,
  [TopicLinkType.ChatMessage]: ChatMessageLink,
  [TopicLinkType.File]: FileLink,
};

export function newTopicLinkForTarget(topic: Topic, target: LinkTarget): TopicLink {
  let linkClass = Object.values(kLinkClasses).find(linkClass => target instanceof linkClass.targetClass);
  if (!linkClass) {
    throw new NotSupported(gt`This cannot be added to a topic`);
  }
  let link = new linkClass(topic);
  link.setTarget(target);
  return link;
}

/** @param json The `mentions` of the topic. Without the links of types that we don't know. */
export function topicLinksFromJSONLD(topic: Topic, json: any): TopicLink[] {
  let links: TopicLink[] = [];
  for (let linkJSON of ensureArray(json)) {
    try {
      let linkClass = getOwnProperty(kLinkClasses, linkJSON?.["@type"]);
      if (linkClass) {
        let link = new linkClass(topic);
        link.fromJSONLD(linkJSON);
        links.push(link);
      }
    } catch (ex) {
      topic.account.dataError(ex);
    }
  }
  return links;
}

/** @returns the links from all topics to this target */
export function topicLinksTo(target: LinkTarget): Collection<TopicLink> {
  let targetID = newTopicLinkForTarget(null, target).targetID;
  return appGlobal.topicLinks.filter(link => targetID && link.targetID == targetID);
}
