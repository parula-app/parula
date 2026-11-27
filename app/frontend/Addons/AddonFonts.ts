import type { AppFonts } from "../../logic/Addons/Sandbox/SandboxFrame";
import css from "../asset/font/Karla.css?raw";
import karla from "../asset/font/Karla.woff2?inline";
import karlaExt from "../asset/font/Karla-ext.woff2?inline";
import karlaItalic from "../asset/font/Karla-italic.woff2?inline";
import karlaItalicExt from "../asset/font/Karla-italic-ext.woff2?inline";

/** The app's font, for addon frames */
export const appFonts: AppFonts = {
  css,
  files: {
    "./Karla.woff2": karla,
    "./Karla-ext.woff2": karlaExt,
    "./Karla-italic.woff2": karlaItalic,
    "./Karla-italic-ext.woff2": karlaItalicExt,
  },
};
