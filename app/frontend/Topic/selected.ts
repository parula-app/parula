import type { Topic } from "../../logic/Topic/Topic";
import type { TopicAccount } from "../../logic/Topic/TopicAccount";
import { AppWindow } from "../MainWindow/AppWindow";
import { writable, type Writable } from "svelte/store";

export let selectedAccount: Writable<TopicAccount> = AppWindow.perWindow(() => writable(null));
export let selectedTopic: Writable<Topic> = AppWindow.perWindow(() => writable(null));
