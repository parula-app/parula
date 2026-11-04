import conditionalCompile from "vite-plugin-conditional-compile";
import { webMail, includeProprietary } from "../logic/build";
import { sourceLocale, locales } from "./list";

export default {
  include: [
    "frontend/**/*.{ts,js,svelte}",
    "lookout/**/*.{ts,js,svelte}",
    "logic/**/*.{ts,js}",
  ],
  exclude: ["**/*.d.ts"], 
  path: "l10n/locales/**/messages.json",
  templateFile: "messages.template.json",
  sourceLocale: sourceLocale,
  locales: locales,
  // Add necessary preprocessors from vite.config.ts
  preprocessors: [
    conditionalCompile({
      // <https://github.com/LZS911/vite-plugin-conditional-compile/blob/master/README.md>
      env: {
        // For conditional `// #if [FOO]` statements in the code
        WEBMAIL: webMail && includeProprietary ? webMail : undefined,
        PROPRIETARY: includeProprietary ? true : undefined,
      },
    }),
  ],
}