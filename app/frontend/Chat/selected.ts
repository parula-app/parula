import type { ChatAccount } from "../../logic/Chat/ChatAccount";
import type { ChatRoom } from "../../logic/Chat/ChatRoom";
import type { ChatMessage } from "../../logic/Chat/ChatMessage";
import type { Editor } from '@tiptap/core';
import { AppWindow } from "../MainWindow/AppWindow";
import { writable, type Writable } from "svelte/store";

export let selectedAccount: Writable<ChatAccount> = AppWindow.perWindow(() => writable(null));
export let selectedRoom: Writable<ChatRoom> = AppWindow.perWindow(() => writable(null));
export let selectedDraft: Writable<ChatMessage> = AppWindow.perWindow(() => writable(null));
export let selectedEditor: Writable<Editor> = AppWindow.perWindow(() => writable(null));
