import { getBaseDomainFromURL } from "./netUtil";
import type { URLString } from "./util";
import DOMPurify from "dompurify"; // https://github.com/cure53/DOMPurify
import { compile as makeHTMLToText } from "html-to-text";
import markdownit from "markdown-it";
import { gt } from "../../l10n/l10n";

let htmlToText: (html: string) => string;

export function convertHTMLToText(html: string): string {
  if (!htmlToText) {
    const options = {
      formatters: {
        removeFormatter: () => { },
      },
      selectors: [
        {
          selector: "img",
          format: "removeFormatter",
        },
        {
          selector: "style",
          format: "removeFormatter",
        },
      ],
    };
    htmlToText = makeHTMLToText(options);
  }
  let text = htmlToText(sanitizeHTML(html));
  return text;
}

let markdownitInstance;
export function convertTextToHTML(plaintext: string): string {
  if (!markdownitInstance) {
    markdownitInstance = markdownit({
      linkify: true,
      breaks: true,
    });
  }
  let html = markdownitInstance.render(plaintext);
  return sanitizeHTML(html);
}

export function fixNewlines(text: string): string {
  return text?.replace(/\r?\n/g, "\r\n");
}

/** Remove dangerous HTML from untrusted content.
 * Intended only as additional security (defense in depth),
 * not as sole protection. Render it in a jailed sandboxed `<iframe>`.
 * @returns HTML snipplet, not whole document */
export function sanitizeHTML(html: string): string {
  if (!html) {
    return "";
  }
  includeExternal = false;
  let sanitized = DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ["svg", "mathml", "form"],
    WHOLE_DOCUMENT: true,
  });
  return sanitized;
}

/** Similar to `sanitizeHTML()`,
 * but additionally drops `<style>`, which would affect the rest of the document.
 * The `style` attribute stays allowed, because it applies only to the element itself.
 *
 * E.g. to render HTML inline as `{@html san…(html)}` instead of in an `<iframe>`.
 * Warning: Don't use this sanitizer as the only defense.
 * Use this in combination with other defenses, e.g. for
 * MarkDown->HTML without accepting HTML from the source MarkDown.
 * @returns HTML snipplet, not whole document */
export function sanitizeHTMLWithoutStyleTag(html: string): string {
  if (!html) {
    return "";
  }
  includeExternal = false;
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ["svg", "mathml", "style", "form"],
  });
}

/** Allow to load images from Internet */
export function sanitizeHTMLExternal(html: string): string {
  if (!html) {
    return "";
  }
  includeExternal = true;
  let sanitized = DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ["svg", "mathml", "form"],
    WHOLE_DOCUMENT: true,
  });
  includeExternal = false;
  return sanitized;
}

// <copied from="https://github.com/cure53/DOMPurify/blob/main/demos/hooks-proxy-demo.html" modified="true" license="Apache 2.0">
const proxy = 'http://localhost:5454/proxy?url=';
const cssURLRegex = /url\((?!["']?data:)["']?/gim;
const urlAttributes = ['action', 'background', 'href', 'poster', 'src', 'srcset'];

function urlAttribute(url: URLString, includeExternal = false) {
  if (!url) {
    return "";
  }
  if (url.startsWith("data:image/") || url.startsWith("cid:") ||
    includeExternal && (url.startsWith("https://") || url.startsWith("http://"))) {
    return url; // or `${proxy}${escape(url)}`;
  }
  return "";
}

/** Keeps `srcset` only if every image in it passes `urlAttribute()` */
function srcsetAttribute(srcset: URLString): string {
  for (let word of srcset.split(/\s+/)) {
    let url = word.replace(/^,+|,+$/g, ""); // remove , at start or end
    let isDescriptor = "wxh".includes(url.slice(-1).toLowerCase()) && !isNaN(Number(url.slice(0, -1))); // number and letter, e.g. "1.5x"
    if (url && !isDescriptor && !urlAttribute(url)) {
      return "";
    }
  }
  return srcset;
}

function addStyles(output: string[], styles: CSSStyleDeclaration) {
  if (styles) {
    output.push(styleDeclarations(styles));
  }
};

/** The declarations of `styles` as CSS text, with external URLs redirected to our proxy.
 * `cssText` keeps the declaration order and the `!important` flags. Mails need
 * `!important` in their `@media` rules to override their inline styles. */
function styleDeclarations(styles: CSSStyleDeclaration): string {
  return styles.cssText.replace(cssURLRegex, `$&${proxy}`);
};

function addCSSRules(output: string[], cssRules = []) {
  for (let rule of cssRules) {
    switch (rule.type) {
      case CSSRule.STYLE_RULE:
        output.push(`${rule.selectorText} {`);
        addStyles(output, rule.style);
        output.push('}\n');
        break;
      case CSSRule.MEDIA_RULE:
        output.push(`@media ${rule.media.mediaText} {`);
        addCSSRules(output, rule?.cssRules);
        output.push('}\n');
        break;
      case CSSRule.FONT_FACE_RULE:
        output.push('@font-face {');
        addStyles(output, rule.style);
        output.push('}\n');
        break;
      case CSSRule.KEYFRAMES_RULE:
        output.push(`@keyframes ${rule.name} {`);
        for (let frame of rule.cssRules) {
          if (frame.type === CSSRule.KEYFRAME_RULE && frame.keyText) {
            output.push(`${frame.keyText} {`);
            addStyles(output, frame.style);
            output.push('}\n');
          }
        }
        output.push('}\n');
        break;
      default:
        break;
    }
  }
};

if (!DOMPurify.addHook) { // for unit tests only. TODO Load it in vitests as well
  DOMPurify.addHook = () => null;
  DOMPurify.sanitize = (html: string) => html;
  console.log("Warning: DOMPurify not loaded. Normal in unit tests, otherwise dangerous.");
}

DOMPurify.addHook('uponSanitizeElement', (node, data) => {
  if (data.tagName === 'style') {
    const output: string[] = [];
    addCSSRules(output, (node as HTMLStyleElement)?.sheet?.cssRules);
    node.textContent = output.join("\n");
  }
});

let includeExternal = false;
DOMPurify.addHook('afterSanitizeAttributes', node => {
  for (let attribute of urlAttributes) {
    if (node.hasAttribute(attribute)) {
      if (node.tagName.toLowerCase() == "a" && attribute == "href") {
        try {
          // New window requests are caught by e2 index.ts setWindowOpenHandler()
          node.setAttribute("target", "_blank");
          node.setAttribute("source", "convert-html");
          let url = node.getAttribute(attribute);
          if (!url) {
            continue;
          }
          let domain = getBaseDomainFromURL(url);
          node.setAttribute("title", domain + "\n\n" + url.substring(0, 120));
        } catch (ex) {
          node.setAttribute(attribute, "");
          node.setAttribute("title", gt`Broken URL`);
        }
      } else if ((node.tagName.toLocaleLowerCase() == "img" && attribute == "src") ||
          (node.tagName.toLocaleLowerCase() == "link" && node.getAttribute("rel") == "stylesheet" && attribute == "href")) {
        let orgURL = node.getAttribute(attribute);
        let newURL = urlAttribute(orgURL, includeExternal);
        node.setAttribute(attribute, newURL);
      } else if (attribute == "srcset") {
        node.setAttribute(attribute, srcsetAttribute(node.getAttribute(attribute)));
      } else {
        let orgURL = node.getAttribute(attribute);
        let newURL = urlAttribute(orgURL);
        node.setAttribute(attribute, newURL);
      }
    }
  }

  if (node.hasAttribute('style')) {
    let styles = styleDeclarations((node as HTMLElement).style);
    if (styles) {
      node.setAttribute('style', styles);
    } else {
      node.removeAttribute('style');
    }
  }
});
// </copied>
