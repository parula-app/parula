How our UI translation works

# Requirements

Our requirements are:
* In the code, the verbatim English string is hardcoded, e.g.
  ```
  tr`Some English words ending with ${ending}`
  ```
  This:
  a) is fail-safe, because missing translations can fall back to that
  b) avoids that we have to invent new string IDs and it
  c) allows to delay the localization, not touching multiple files
    all the time during daily development.
* Must handle plural forms in all the languages (0, 1, few, many etc.)
* Should handle brand names without code in the UI.
* L10n file format must be supported by online web tools for translators.

# Library

We chose lingui and svelte-18n-lingui, because:
* It supports the Svelte code files
* It can automatically "extract" the strings from the code into
  the English source translation file.

# Process

1. During dev, in .svelte files, use
  ```
  $t`Some English words ending with ${ending}`
  ```
  and in .ts modules, e.g. logic files, use
  ```
  gt`Some English words ending with ${ending}`
  ```
  Both functions are defined in `app/l10n/l10n.ts`.
2. Before a translation round, run
  `yarn run l10n:extract` = `lingui extract`
  (called "extraction"), which searches the code for the above
  t and gt functions, and adds the new strings to
  `l10n/locales/en/messages.json`.
3. Send the translation files `l10n/locales/*/messages.json`
   (including the above English source file) to translation.
4. The tools will find which strings are not yet translated, and
  trigger translation for those.
5. Translation (AI or humans)
   Klingon in pIqaD (`tlh-Piqd`) is not translated, but generated
   from Klingon in Latin (`tlh`) with `yarn run l10n:pIqaD`.
6. The tools will merge the new translations with the existing
   translations, adding only the new or changed strings.
7. The tools will export back into the translation file format that
  we use, and commit it to a git branch.
8. We merge the new translations to master branch.
9. The vite plugin `lingui()` (in `vite.config.js`) reads its config file
  `lingui.config.ts`. Based on our config, it compiles the
  `l10n/locales/*/messages.json` files (which contain
  `{foo}` placeholders) to
  `l10n/locales/*/messages-compiled.json` files, which will be read
  by the lingui UI code at application startup and are optimized
  for fast parsing.
10. Test
11. Ship it

# Instructions for translators

* Keep the translation short, but correct and easy to understand.
* Our audience are business users, freelancers and private users.
* The language style should be relatively informal, a little colloquial,
  personal, and speaking to the user's heart. Avoid being overly formal
  and stiff.
* If the language offers a formal "you" and a family/friend "you", use
  the formal "you", unless it's very stiff and uncommon in your
  language. Use the "you" form that most other software uses.
* For technical terms, make sure you use the correct technical term.
  If there is a translated form of a technical term, but the English
  form is also in common use, prefer the English form. That allows users
  to get help on international forums and allows our support and AI
  translation tools to understand the error messages.
