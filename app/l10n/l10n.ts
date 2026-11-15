import { MessageFormatter, pluralTypeHandler, type FormatValues } from "@ultraq/icu-message-formatter";
import { derived, writable } from "svelte/store";
import { generateMessageID } from "./generateMessageID";
import { sanitize } from '../../lib/util/sanitizeDatatypes';

import { languageMessages, sourceLocale, localeMapping } from './list';
import { addDateNames } from './dateNames';

/** @lang Either 2-letter ISO lang code, or 5-letter ISO locale code
 * Must match list.ts */
export function setUILocale(lang: string) {
  // This function *must* be sync, for gt() to work in TS modules

  lang = localeMapping[lang.toLowerCase()] ?? lang;
  // e.g. 'en' for 'en-US'
  let lang2 = lang.substring(0, 2);

  let availableLang =
    languageMessages[lang] ? lang :
    languageMessages[lang2] ? lang2 :
    sourceLocale;
  let messages = languageMessages[availableLang];
  locale.set(availableLang, messages);
}

const handlers = { plural: pluralTypeHandler };
let formatter: MessageFormatter;
let messages: Record<string, string>;

/**
 * Cache is not needed since the all messages are loaded
 * on load and also the `@ultraq/icu-messageformatter`
 * caches the results of formatted messages
 * <https://github.com/ultraq/icu-message-formatter/blob/main/source/MessageFormatter.js#L78>
 */
function createLocale(defaultLocale = 'en-US', defaultMessages = {}) {
  const { subscribe, set } = writable(defaultLocale);

  // Necessary for plural to work; it expects a locale to be set.
  formatter = new MessageFormatter(defaultLocale, handlers);
  messages = defaultMessages;

  return {
    subscribe,
    /**
     * Sets the locale and loads the messages
     * @param locale
     * @param msgs
     */
    set: (locale: string, msgs: Record<string, string>) => {
      formatter = new MessageFormatter(locale, handlers);
      messages = msgs;
      set(locale);
    },
  };
}
export const locale = createLocale();

/** Alternative implementation with dynamic loading of locale files. Not used. */
/*
export async function setUILocaleAsync(lang: string) {
  // e.g. 'en' for 'en-US'
  let lang2 = lang.substring(0, 2);

  try {
    lang = lang2;
    const { messages } = await import(`./locales/${lang}/messages.ts`);
    locale.set(lang, messages);
  } catch (ex) {
    lang = 'en';
    const { messages } = await import(`./locales/${lang}/messages.ts`);
    locale.set(lang, messages);
  }
}
*/

let cachedUILocale: string;
/** @returns ISO code for the locale that we are using */
export function getUILocale(): string {
  if (!cachedUILocale) {
    // Node defines the `localStorage` global, but it's undefined without --localstorage-file
    if ("localStorage" in global && localStorage) {
      cachedUILocale = sanitize.nonemptystring(localStorage.getItem("ui.locale"), navigator.language);
    } else {
      cachedUILocale = "en-US";
    }
  }
  return cachedUILocale;
}

export function getUILocalePref(): string {
  return sanitize.nonemptystring(localStorage.getItem("ui.locale"), "");
}

export function saveUILocale(language: string) {
  localStorage.setItem("ui.locale", language);
  cachedUILocale = null;
}

let cachedDateTimeLocale: string;

export function getDateTimeLocale(): string {
  cachedDateTimeLocale ??=
    sanitize.nonemptystring(localStorage.getItem("ui.dateTime"), getUILocale());
  return cachedDateTimeLocale;
}

export function getDateTimeLocalePref(): string {
  return sanitize.nonemptystring(localStorage.getItem("ui.dateTime"), "");
}

export function saveDateTimeLocale(language: string) {
  cachedDateTimeLocale = null;
  localStorage.setItem("ui.dateTime", language);
  addDateNames(getDateTimeLocale());
}

let loadedLocale = false;
function initLocale() {
  setUILocale(getUILocale());
  // Node has no `localStorage`
  if ("localStorage" in global && localStorage) {
    addDateNames(getDateTimeLocale());
  }
}

/** In strings, this is the separator between the actual string and the comment for translators or machine translation.
 * This allows to give context to short strings.
 * It also allows to disambiguate "read" (past tense) between "read" (instruction).
 *
 * Also in config.ts because of the plugin */
export const commentSymbol = " *=> ";

/** Used in Svelte files, e.g.
 * $t`Hello World!` or $t`Hello ${username}!` */
export const t = derived(locale, () => gt);

/** Used in .ts modules, e.g.
 * gt`Hello World!` or gt`Hello ${username}!` */
export function gt(descriptor: readonly string[], ...args: any[]) {
  let str: string = "";
  str = descriptor[0];
  args.forEach((_arg, i) => {
    str += `{${i}}` + descriptor[i + 1];
  });
  let segments: string[] = str.split(commentSymbol);
  let msg: MessageDescriptor = {
    id: generateMessageID(segments[0], segments[1]),
    defaultMessage: segments[0],
    description: segments[1],
  }
  let values = { ...args };

  return translateString(msg, values);
}

/**
 * Translates a plural message based on a number and variations
 * @param num
 * @param variations
 * @returns translated string
 */
export const plural = derived(locale, () => gPlural);

/**
 * Translates a plural message based on a number and variations
 *
 * We need this to generate and match the variation according
 * to the number provided, we could just manually write ICU format
 * manually `{num, plural, variations}` but we're using this
 * to avoid changing the entire code and also the manually written
 * on would be `{0, plural, variations}` because the placeholders
 * are numbers and that also changes the hashID and would require
 * us to retranslate.
 * @param num
 * @param variations
 * @returns translated string
 */
export function gPlural(num: number, variations: Record<string, string>) {
  let pluralOptions = "";
  Object.entries(variations).forEach(([key, value]) => {
    pluralOptions += ` ${key} {${value}}`;
  });
  let str = `{num, plural,${pluralOptions}}`;
  let message: MessageDescriptor = {
    id: generateMessageID(str),
    defaultMessage: str,
  };
  return translateString(message, { num });
}


/**
 * Translates based on a message descriptor and values
 *
 * This default translation function that does the translation
 * and fallback handling for `t()` and `plural()`. Without
 * it the other function would not work. Since it is the entry point
 * for all translation functions, the `initLocale()` function is
 * called here instead
 * @param descriptor
 * @param values
 * @returns translated string
 */
export function translateString(descriptor: MessageDescriptor, values: FormatValues): string {
  if (!loadedLocale) {
    initLocale(); // `setUILocale()` must be sync for this to work
    loadedLocale = true;
  }
  let message: string = messages[descriptor.id] ?? descriptor.defaultMessage;
  // This condition is for the <T> component extract error
  // where the message is the same as id which renders the id
  if (message == descriptor.id) {
    message = descriptor.defaultMessage;
  }
  try {
    // Throws an error if there's an syntax error
    // which returns undefined
    return formatter.format(message, values);
  } catch (ex) {
  }
  // Fallback to parsing the default message
  // if the default message was not used to parse
  if (message != descriptor.defaultMessage) {
    try {
      return formatter.format(descriptor.defaultMessage, values);
    } catch (ex) {
    }
  }
  // Fallback to unparsed message if the previous messages failed
  return message;
}

export interface MessageDescriptor {
  id: string;
  defaultMessage: string;
  description?: string;
}
