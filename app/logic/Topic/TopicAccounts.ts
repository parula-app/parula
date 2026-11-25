import { TopicAccount } from './TopicAccount';
import { SQLTopicStorage } from './SQL/SQLTopicStorage';
import { LocalFileTopicStorage } from './File/LocalFileTopicStorage';
import { DummyTopicStorage } from './SQL/DummyTopicStorage';
import { appGlobal } from '../app';
import { NotReached, assert } from '../util/util';
import { gt } from '../../l10n/l10n';
import type { Collection } from 'svelte-collections';
import { Topic } from './Topic';

export function newTopicAccountForProtocol(protocol: string): TopicAccount {
  let Topic = _newTopicAccountForProtocol(protocol);
  // #if [!WEBMAIL]
  Topic.storage = new SQLTopicStorage();
  // #else
  Topic.storage = new DummyTopicStorage();
  // #endif
  return Topic;
}

function _newTopicAccountForProtocol(protocol: string): TopicAccount {
  if (protocol == "topic-local") {
    return new TopicAccount();
  }
  throw new NotReached(`Unknown topic account type ${protocol}`);
}

// #if [!WEBMAIL]
export async function readTopicAccounts(): Promise<Collection<TopicAccount>> {
  let topicAccounts = await SQLTopicStorage.readTopicAccounts();
  if (topicAccounts.isEmpty) {
    topicAccounts.add(await createLocalTopicAccount());
  }
  for (let account of topicAccounts) {
    try {
      await setContentStorage(account);
    } catch (ex) {
      account.errorCallback(ex);
    }
  }
  return topicAccounts;
}
// #endif

/** Adds or removes the files on this computer, as `account.saveAsLocalFiles` says, and syncs them with the database */
export async function setContentStorage(account: TopicAccount) {
  let local = account.contentStorage.find(storage => storage instanceof LocalFileTopicStorage);
  if (account.saveAsLocalFiles && !local) {
    local = new LocalFileTopicStorage(account);
    account.contentStorage.add(local);
    await local.sync(account);
  } else if (!account.saveAsLocalFiles && local) {
    account.contentStorage.remove(local);
  }
}

export async function createLocalTopicAccount(): Promise<TopicAccount> {
  console.log("Creating local topic storage");
  let personal = newTopicAccountForProtocol("topic-local");
  personal.name = gt`Personal topics`;
  await personal.save();
  let root = createRootTopic(appGlobal.me.name);
  root.account = personal;
  personal.topics.add(root);
  await root.save();
  return personal;
}

export let rootTopic: Topic;

export function createRootTopic(name: string): Topic {
  if (rootTopic) {
    return rootTopic;
  }
  rootTopic = new Topic();
  rootTopic.id = "root";
  rootTopic.name = name?.split(" ")[0] ?? "You";
  rootTopic.parent = null;
  return rootTopic;
}

export function setRootTopic(topic: Topic) {
  assert(!topic.parent, "Need root topic");
  rootTopic ??= topic;
}
