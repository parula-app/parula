import type { MailIdentity } from "../../../logic/Mail/MailIdentity";
import { writable } from "svelte/store";

export const selectedIdentity = writable<MailIdentity>();
