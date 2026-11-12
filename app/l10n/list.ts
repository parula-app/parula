import en from './locales/en/messages.json';
import de from './locales/de/messages.json';
import fr from './locales/fr/messages.json';
import it from './locales/it/messages.json';
import es from './locales/es/messages.json';
import pt from './locales/pt/messages.json';
import pl from './locales/pl/messages.json';
import ja from './locales/ja/messages.json';
import zh from './locales/zh/messages.json';
import zhHant from './locales/zh-Hant/messages.json';
import enGB from './locales/en-GB/messages.json';

import ar from './locales/ar/messages.json';
import cs from './locales/cs/messages.json';
import da from './locales/da/messages.json';
import el from './locales/el/messages.json';
import fi from './locales/fi/messages.json';
import nb from './locales/nb/messages.json';
import nl from './locales/nl/messages.json';
import ro from './locales/ro/messages.json';
import ru from './locales/ru/messages.json';
import sv from './locales/sv/messages.json';
import uk from './locales/uk/messages.json';
import et from './locales/et/messages.json';
import lt from './locales/lt/messages.json';
import lv from './locales/lv/messages.json';
import bg from './locales/bg/messages.json';
import sl from './locales/sl/messages.json';

import az from './locales/az/messages.json';
import eo from './locales/eo/messages.json';
import fa from './locales/fa/messages.json';
import ga from './locales/ga/messages.json';
import he from './locales/he/messages.json';
import hi from './locales/hi/messages.json';
import hu from './locales/hu/messages.json';
import id from './locales/id/messages.json';
import ko from './locales/ko/messages.json';
import sk from './locales/sk/messages.json';
import th from './locales/th/messages.json';
import tr from './locales/tr/messages.json';
import la from './locales/la/messages.json';
import tlh from './locales/tlh/messages.json';

import bn from './locales/bn/messages.json';
import paArab from './locales/pa-Arab/messages.json';
import ta from './locales/ta/messages.json';
import ur from './locales/ur/messages.json';
import vi from './locales/vi/messages.json';

/** Map of lang code to messages.
 * Lang codes: <https://www.wikiwand.com/en/List_of_ISO_639_language_codes> */
export const languageMessages: Record<string, Record<string, string>> = {
  en: en,
  de: de,
  fr: fr,
  it: it,
  es: es,
  pt: pt,
  pl: pl,
  ja: ja,
  zh: zh,
  "zh-Hant": zhHant,
  "en-GB": enGB,
  ar: ar,
  cs: cs,
  da: da,
  el: el,
  fi: fi,
  nb: nb,
  nl: nl,
  ro: ro,
  ru: ru,
  sv: sv,
  uk: uk,
  et: et,
  lt: lt,
  lv: lv,
  bg: bg,
  sl: sl,
  az: az,
  eo: eo,
  fa: fa,
  ga: ga,
  he: he,
  hi: hi,
  hu: hu,
  id: id,
  ko: ko,
  sk: sk,
  th: th,
  tr: tr,
  la: la,
  tlh: tlh,
  bn: bn,
  "pa-Arab": paArab,
  ta: ta,
  ur: ur,
  vi: vi,
};

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
  "pa-pk": "pa-Arab",
  "pa-arab-pk": "pa-Arab",
};

/** List of available locales in this build.
 * Must match ./locales/<locale>/* files and
 * the imports in ./l10n.ts. */
export const locales = Object.keys(localeNames);

export const rtlLocales = [ 'ar', 'fa', 'he', 'pa-Arab', 'ur' ];
