import en from './locales/en/messages.json';

/** Messages of `sourceLocale`. Built in, because `gt` can be called before `setUILocale()` loaded the UI language. */
export const sourceMessages: Record<string, string> = en;

export const sourceLocale = 'en';

/* List of languages, as shown in the settings UI.
 * Do *not* translate these.
 * (Otherwise, if you do cannot read Chinese, you cannot find German anymore.)
 * Lang codes: <https://www.wikiwand.com/en/List_of_ISO_639_language_codes> */
export const localeNames = {
  //'sq': "Albanian / Shqip",
  'ar': "Arabic / اَلْعَرَبِيَّةُ",
  'az': "Azerbaijani / Azərbaycan dili",
  'bn': "Bengali / বাংলা",
  'bg': "Bulgarian / Български",
  'zh': "Chinese (Simplified, China) / 简体中文",
  'zh-Hant': "Chinese (Traditional) / 繁體中文",
  'cs': "Czech / Čeština",
  'da': "Danish / Dansk",
  'nl': "Dutch / Nederlands",
  'en': "English",
  'en-GB': "English (British)",
  'eo': "Esperanto",
  'et': "Estonian / Eesti keel",
  'fi': "Finnish / Suomi",
  'fr': "French / Français",
  'de': "German / Deutsch",
  'el': "Greek / Ελληνικά",
  'he': "Hebrew / עברית",
  'hi': "Hindi / हिन्दी",
  'hu': "Hungarian / Magyar nyelv",
  'id': "Indonesian / bahasa Indonesia",
  'ga': "Irish / Gaeilge",
  'it': "Italian / Italiano",
  'ja': "Japanese / 日本語",
  'tlh': "Klingon / tlhIngan Hol",
  'ko': "Korean / 한국어",
  'la': "Latin / Latina",
  'lv': "Latvian / Latviski",
  'lt': "Lithuanian / Lietuviškai",
  //'ms': "Malay / بهاس ملايو",
  'nb': "Norwegian / Norsk", // Bokmål
  //'no': "Norwegian / Norsk",
  'fa': "Persian / فارسی",
  'pl': "Polish / Polski",
  'pt': "Portuguese / Português",
  'pa-Arab': "Punjabi (Pakistan) / پنجابی",
  'ro': "Romanian / Românește",
  'ru': "Russian / Русский язык",
  'sk': "Slovak / Slovenčina",
  'sl': "Slovenian / Slovenščina",
  'es': "Spanish / Español",
  'sv': "Swedish / Svenska",
  //'tl': "Tagalog / Wikang Tagalog",
  'ta': "Tamil / தமிழ்",
  'th': "Thai / ภาษาไทย",
  'tr': "Turkish / Türkçe",
  'uk': "Ukranian / Українська",
  'ur': "Urdu / اُردُو",
  'vi': "Vietnamese / tiếng Việt",
};

/** key: locale code from navigator.language, in lower case
 * value: our lang code, from the above lists. */
export const localeMapping: Record<string, string> = {
  "en-gb": "en-GB",
  "en-ie": "en-GB",
  "en-au": "en-GB",
  "en-nz": "en-GB",
  "en-za": "en-GB",
  "zh-tw": "zh-Hant",
  "zh-hk": "zh-Hant",
  "zh-sg": "zh",
};

/** List of available locales in this build.
 * Must match ./locales/<locale>/* files and
 * the imports in ./l10n.ts. */
export const locales = Object.keys(localeNames);

export const rtlLocales = [ 'ar', 'fa', 'he', 'pa-Arab', 'ur' ];
