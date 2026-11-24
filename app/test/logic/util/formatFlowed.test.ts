import { convertFormatFlowedToHTML } from '../../../logic/util/formatFlowed';
import markdownit from "markdown-it";
import { convertHTMLToText } from "../../../logic/util/convertHTML";
import formatHTML from 'html-formatter';
import { expect, test } from 'vitest';
// @vitest-environment happy-dom

const testMails = [
  {
    html: `
<html><body><p>Fred wrote on 19.12.2024, 11:50:</p>
<blockquote type="cite"><blockquote type="cite"><p>Yes, that time works for me. Thanks! dfgd sfggsjhj gd lsglskdhg öshdkjgfh sdglkjsdg kshdlkjfgh slkjdhg lkjsdglkj hdsflkjgh slkjhglkjdsh gj ahfgökjh aflgh alkjhg lkjag lkjhadsökjgh adfghkjdg lkjh dgflkh dflkjgh dslhglkjsdhg lkdhgk shdflkjgk</p></blockquote><p>Added to my calendar.
</p></blockquote>
<p>ditto</p>
<blockquote type="cite"><blockquote type="cite">
<p>What's your name? I tried, but couldn't find you based 
on your name Dshgsdgsgsdfsdgfhfgjdsghfghjahjgsfhjhjydfhgskdgfkgfkgkhgsdkfhgsd DshgsdgsgsdfsdgfhfgjdsghfghjahjgsfhjhjydfhgskdgfkgfkgkhgsdkfhgsdDshgsdgsgsdfsdgfhfgjdsghfghjahjgsfhjhjydfhgskdgfkgfkgkhgsdkfhgsdDshgsdgsgsdfsdgfhfgjdsghfghjahjgsfhjhjydfhgskdgfkgfkgkhgsdkfhgsd</p></blockquote><p>fred</p></blockquote><p>It works. Feel free to create branches, if you prefer.</p>
<p></p><p>From Marcha</p></body></html>`,
    formatFlowed: `Fred wrote on 19.12.2024, 11:50:
>> Yes, that time works for me. Thanks! dfgd sfggsjhj gd lsglskdhg 
>> öshdkjgfh sdglkjsdg kshdlkjfgh slkjdhg lkjsdglkj hdsflkjgh slkjhglkjdsh 
>> gj ahfgökjh aflgh alkjhg lkjag lkjhadsökjgh adfghkjdg lkjh dgflkh 
>> dflkjgh dslhglkjsdhg lkdhgk shdflkjgk
>
> Added to my calendar.

ditto

>> What's your name? I tried, but couldn't find you based on your name 
>> Dshgsdgsgsdfsdgfhfgjdsghfghjahjgsfhjhjydfhgskdgfkgfkgkhgsdkfhgsd 
>> DshgsdgsgsdfsdgfhfgjdsghfghjahjgsfhjhjydfhgskdgfkgfkgkhgsdkfhgsdDshgsdgsgsdfsdgfhfgjdsghfghjahjgsfhjhjydfhgskdgfkgfkgkhgsdkfhgsdDshgsdgsgsdfsdgfhfgjdsghfghjahjgsfhjhjydfhgskdgfkgfkgkhgsdkfhgsd
>
> fred

It works. Feel free to create branches, if you prefer.


 From Marcha
`,
  },
  /*
  {
    html: `
  <html><body>
  <blockquote type="cite">
  <p>Here's some ASCII-art for you:</p>
  <p>
============== ============ ============ ============ =========<br>
============== ============ ============ ============ =========<br>
============== ============ ============ ============ =========<br>
</p></blockquote>
</body></html>`,
    formatFlowed: `> Here's some ASCII-art for you:
> ============== ============ ============ ============ =========
> ============== ============ ============ ============ =========
> ============== ============ ============ ============ =========
`,
  },
  */
  {
    html: `
  <html><body>
  <p>Hi</p>
  <blockquote type="cite">
  <p><strong>Bold</strong> <em>emphasis</em></p>
  </blockquote>
  <p><strong>Bold</strong> <em>emphasis over multiple lines dfgkhgf kfg kjsgfkhg dshgf kahgskfjgds kdjkajsdgkjafkjfkj</em></p>
</body></html>`,
    formatFlowed: `Hi

> **Bold** *emphasis*

**Bold** *emphasis over multiple lines dfgkhgf kfg kjsgfkhg dshgf 
kahgskfjgds kdjkajsdgkjafkjfkj*
`,
  },
  /*
  {
    html: `
  <html><body>
  <p>Hi</p>
  <blockquote type="cite">
  <ul>
  <li>One</li>
  <li>Two over multiple lines dfgkhgf kfg kjsgfkhg dshgf kahgskfjgds kdjkajsdgkjafkjfkj</li>
  <li>Three really long word DshgsdgsgsdfsdgfhfgjdsghfghjahjgsfhjhjydfhgskdgfkgfkgkhgsdkfhgsdDshgsdgsgsdfsdgfhfgjdsghfghjahjgsfhjhjydfhgskdgfkgfkgkhgsdkfhgsdDshgsdgsgsdfsdgfhfgjdsghfghjahjgsfhjhjydfhgskdgfkgfkgkhgsdkfhgsd</li>
  </ul>
  </blockquote>
  <p>Start</p>
  <ul>
  <li>One</li>
  <li>Two over multiple lines dfgkhgf kfg kjsgfkhg dshgf kahgskfjgds kdjkajsdgkjafkjfkj</li>
  <li>Three really long word DshgsdgsgsdfsdgfhfgjdsghfghjahjgsfhjhjydfhgskdgfkgfkgkhgsdkfhgsdDshgsdgsgsdfsdgfhfgjdsghfghjahjgsfhjhjydfhgskdgfkgfkgkhgsdkfhgsdDshgsdgsgsdfsdgfhfgjdsghfghjahjgsfhjhjydfhgskdgfkgfkgkhgsdkfhgsd</li>
  </ul>
  <p>End</p>
</body></html>`,
    formatFlowed: `Hi

> * One
> * Two over multiple lines dfgkhgf kfg kjsgfkhg dshgf kahgskfjgds
>    kdjkajsdgkjafkjfkj
> * Three really long word
>    DshgsdgsgsdfsdgfhfgjdsghfghjahjgsfhjhjydfhgskdgfkgfkgkhgsdkfhgsdDshgsdgsgsdfsdgfhfgjdsghfghjahjgsfhjhjydfhgskdgfkgfkgkhgsdkfhgsdDshgsdgsgsdfsdgfhfgjdsghfghjahjgsfhjhjydfhgskdgfkgfkgkhgsdkfhgsd
  </ul>

Start

* One
* Two over multiple lines dfgkhgf kfg kjsgfkhg dshgf kahgskfjgds
   kdjkajsdgkjafkjfkj
* Three really long word
   DshgsdgsgsdfsdgfhfgjdsghfghjahjgsfhjhjydfhgskdgfkgfkgkhgsdkfhgsdDshgsdgsgsdfsdgfhfgjdsghfghjahjgsfhjhjydfhgskdgfkgfkgkhgsdkfhgsdDshgsdgsgsdfsdgfhfgjdsghfghjahjgsfhjhjydfhgskdgfkgfkgkhgsdkfhgsd

End
`,
  },
  */
];

test.skip("Convert HTML to format=flowed", () => {
  for (let testMail of testMails) {
    expect(convertHTMLToText(testMail.html)).toBe(testMail.formatFlowed);
  }
});

test("Convert format=flowed to HTML", () => {
  let markdownitInstance = markdownit({
    linkify: true,
    breaks: true,
  });
  let formatter = plaintext => markdownitInstance.render(plaintext);
  for (let testMail of testMails) {
    let html = convertFormatFlowedToHTML(testMail.formatFlowed, formatter, false, true);
    expect(formatHTML.render(html)).toBe(formatHTML.render(testMail.html));
  }
});
