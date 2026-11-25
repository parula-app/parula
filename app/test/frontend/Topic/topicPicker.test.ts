// @vitest-environment happy-dom
// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../logic/app";
import { Person, ContactEntry } from "../../../logic/Abstract/Person";
import { TopicAccount } from "../../../logic/Topic/TopicAccount";
import { createRootTopic } from "../../../logic/Topic/TopicAccounts";
import type { Topic } from "../../../logic/Topic/Topic";
import TopicPicker from "../../../frontend/Topic/Picker/TopicPicker.svelte";
import { waitFor } from "../../logic/util/waitFor";
import { flushSync, mount } from "svelte";
import { beforeEach, expect, test } from "vitest";

let root: Topic;
let person: Person;

beforeEach(async () => {
  appGlobal.topicAccounts.clear();
  let account = new TopicAccount();
  account.storage = { saveTopic: async () => {}, deleteTopic: async () => {} } as any;
  root = createRootTopic("Fred");
  root.children.clear();
  root.account = account;
  account.topics.add(root);
  appGlobal.topicAccounts.add(account);
  let project = await root.newChild("Project");
  await project.newChild("Marketing");
  person = new Person();
  person.name = "Fred Test";
  person.emailAddresses.add(new ContactEntry("fred@example.com"));
});

function mountPicker(): HTMLElement {
  let target = document.createElement("div");
  document.body.append(target);
  mount(TopicPicker, { target, props: { target: person } });
  flushSync();
  return target;
}

function checkbox(target: HTMLElement, name: string): HTMLInputElement {
  return [...target.querySelectorAll(".topic")]
    .find(row => row.querySelector("label").textContent.trim() == name)
    ?.querySelector("input");
}

function type(input: HTMLInputElement, text: string) {
  input.value = text;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  flushSync();
}

test("Click on a topic adds the contact to it, and again removes it", async () => {
  let target = mountPicker();
  let marketing = root.descendants.find(topic => topic.name == "Marketing");
  checkbox(target, "Marketing").click();
  await waitFor(() => marketing.links.hasItems);
  expect(marketing.links.first.targetID).toBe("mailto:fred@example.com");
  flushSync();
  expect(checkbox(target, "Marketing").checked).toBe(true);

  checkbox(target, "Marketing").click();
  await waitFor(() => marketing.links.isEmpty);
});

function button(target: HTMLElement, text: string): HTMLButtonElement {
  return [...target.querySelectorAll("button")].find(button => button.textContent.includes(text));
}

test("Search, and create a new sub-topic", async () => {
  let target = mountPicker();
  let input = target.querySelector<HTMLInputElement>("input[type=search]");
  type(input, "mark");
  expect(checkbox(target, "Marketing")).toBeTruthy();
  expect(checkbox(target, "Project")).toBeFalsy();

  type(input, "Release 45");
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
  button(target, "Release 45").click();
  flushSync();
  expect(root.descendants.find(topic => topic.name == "Release 45")).toBeUndefined();
  type(input, "proj");
  button(target, "Project").click();
  let project = root.children.find(topic => topic.name == "Project");
  await waitFor(() => project.children.find(topic => topic.name == "Release 45")?.links.hasItems);
  expect(root.children.find(topic => topic.name == "Release 45")).toBeUndefined();
});

test("Keys in the search field don't reach the shortcuts of the app", () => {
  let target = mountPicker();
  let keys: string[] = [];
  target.addEventListener("keydown", event => keys.push(event.key));
  let input = target.querySelector<HTMLInputElement>("input[type=search]");
  for (let key of ["Backspace", "Delete", "s", "j"]) {
    input.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  }
  expect(keys).toEqual([]);
});
