// HTML that tries to make the app load something from `base`, in every way that HTML and CSS can.
// The addon writes it into a draft. The app renders drafts in its own document, not in a sandbox.

const kPixel = "data:image/gif;base64,R0lGODlhAQABAAAAACw=";

export function evilHTML(base: string): string {
  return `<p>Draft text</p>
<img src="${base}/img.png">
<img src="${kPixel}" srcset="cid:part1 1w, ${base}/srcset.png 999w" sizes="999px">
<picture><source srcset="${base}/source.png"><img src="${kPixel}"></picture>
<div style="background-image: url(${base}/style.png); width: 20px; height: 20px">a</div>
<div style="background-image: image-set('${base}/imageset.png' 1x); width: 20px; height: 20px">b</div>
<div style="list-style-image: url('${base}/list.png'); cursor: url(${base}/cursor.png), auto">c</div>
<style>.evil-sheet { background: url("${base}/sheet.png") } @import url("${base}/import.css"); @font-face { font-family: Evil; src: url(${base}/font.woff2) }</style>
<div class="evil-sheet" style="width: 20px; height: 20px; font-family: Evil">d</div>
<table background="${base}/table.png"><tr><td>e</td></tr></table>
<video poster="${base}/poster.png" src="${base}/video.mp4"></video>
<audio src="${base}/audio.mp3" autoplay></audio>
<input type="image" src="${base}/input.png">
<link rel="stylesheet" href="${base}/link.css">
<link rel="preload" as="image" href="${base}/preload.png">
<object data="${base}/object.png"></object>
<embed src="${base}/embed.png">
<iframe src="${base}/iframe.html"></iframe>
<a href="${base}/link-only-on-click">Link</a>
<img src="${kPixel}" alt="Inline image">`;
}
