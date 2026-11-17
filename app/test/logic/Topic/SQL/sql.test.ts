import { makeTestDatabase } from '../../../../logic/Topic/SQL/SQLDatabase';
import { SQLTopicAccount } from '../../../../logic/Topic/SQL/SQLTopicAccount';
import { SQLTopic } from '../../../../logic/Topic/SQL/SQLTopic';
import { newTopicAccountForProtocol } from '../../../../logic/Topic/TopicAccounts';
import { Topic } from '../../../../logic/Topic/Topic';
import { Paragraph } from '../../../../logic/Topic/PageContent';
import { appGlobal } from '../../../../logic/app';
import { connectToBackend } from '../../util/backend';
import { expect, test } from 'vitest';

test("Save and read topics from SQL database", { timeout: 10000 }, async () => {
  await connectToBackend();
  await makeTestDatabase();

  // Create account
  let originalAccount = newTopicAccountForProtocol("topic-local");
  originalAccount.name = "Test Topics";
  appGlobal.topicAccounts.add(originalAccount);
  await SQLTopicAccount.save(originalAccount);
  expect(originalAccount.dbID).toBeDefined();

  // Create a parent topic
  let parentTopic = new Topic();
  parentTopic.account = originalAccount;
  parentTopic.name = "Parent Topic";
  await SQLTopic.save(parentTopic);
  originalAccount.topics.add(parentTopic);
  expect(parentTopic.dbID).toBeDefined();

  // Create a child topic with content and properties
  let childTopic = new Topic();
  childTopic.account = originalAccount;
  childTopic.name = "Child Topic";
  childTopic.parent = parentTopic;
  let para = new Paragraph(childTopic);
  para.rawHTMLDangerous = "<p>Hello world</p>";
  childTopic.content.add(para);
  childTopic.properties.add({ name: "color", value: "blue" });
  await SQLTopic.save(childTopic);
  originalAccount.topics.add(childTopic);
  expect(childTopic.dbID).toBeDefined();

  // Clear in-memory state
  appGlobal.topicAccounts.clear();

  // Read back
  appGlobal.topicAccounts.addAll(await SQLTopicAccount.readAll());
  let readAccount = appGlobal.topicAccounts.first;
  expect(readAccount).toBeDefined();
  await SQLTopic.readAll(readAccount);

  // Verify account
  expect(readAccount.name).toEqual(originalAccount.name);
  expect(readAccount.dbID).toEqual(originalAccount.dbID);

  // Verify parent topic
  let readParent = readAccount.topics.find(t => t.id === parentTopic.id);
  expect(readParent).toBeDefined();
  expect(readParent.name).toEqual(parentTopic.name);
  expect(readParent.parent).toBeNull();

  // Verify child topic
  let readChild = readAccount.topics.find(t => t.id === childTopic.id);
  expect(readChild).toBeDefined();
  expect(readChild.name).toEqual(childTopic.name);
  expect(readChild.parent?.dbID).toEqual(parentTopic.dbID);
  expect(readChild.content.length).toBe(1);
  expect((readChild.content.first as Paragraph).rawHTMLDangerous).toEqual("<p>Hello world</p>");
  expect(readChild.properties.length).toBe(1);
  expect(readChild.properties.first.name).toEqual("color");
  expect(readChild.properties.first.value).toEqual("blue");
});

