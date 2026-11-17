import type { MailIdentity } from "../../../logic/Mail/MailIdentity";
import { AppWindow } from "../../../frontend/MainWindow/AppWindow";
import { writable } from "svelte/store";

export const selectedIdentity = AppWindow.perWindow(() => writable<MailIdentity>());
