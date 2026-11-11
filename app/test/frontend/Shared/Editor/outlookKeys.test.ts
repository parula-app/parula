// @vitest-environment happy-dom
// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import HTMLEditor from "../../../../frontend/Shared/Editor/HTMLEditor.svelte";
import HTMLEditorToolbar from "../../../../frontend/Shared/Editor/HTMLEditorToolbar.svelte";
import { isMacOS, type Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { flushSync, mount, tick, unmount } from "svelte";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";

beforeAll(() => {
  appGlobal.remoteApp = {} as any;
});

let mounted: Record<string, any>[] = [];

afterEach(() => {
  for (let component of mounted) {
    unmount(component);
  }
  mounted = [];
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

/**
 * Mounts the real editor, with all of Mustang's extensions.
 * In `html`, `|` marks the cursor, and `[` ... `]` mark a selection.
 * The markers are removed before the test starts.
 */
function showEditor(html: string): Editor {
  let target = document.createElement("div");
  document.body.append(target);
  mounted.push(mount(HTMLEditor, { target, props: { html, editor: null } }));
  flushSync();
  let editor = (target.querySelector(".ProseMirror") as any).editor as Editor;
  placeSelection(editor);
  return editor;
}

function placeSelection(editor: Editor) {
  let markers: number[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (!node.isText) {
      return;
    }
    for (let i = 0; i < node.text.length; i++) {
      if ("|[]".includes(node.text[i])) {
        markers.push(pos + i);
      }
    }
  });
  if (!markers.length) {
    return;
  }
  let tr = editor.state.tr;
  for (let marker of [...markers].reverse()) {
    tr.delete(marker, marker + 1);
  }
  // Each deleted marker shifts the later ones by 1
  let from = markers[0];
  let to = markers.length > 1 ? markers[1] - 1 : from;
  tr.setSelection(TextSelection.create(tr.doc, from, to));
  tr.setMeta("addToHistory", false);
  editor.view.dispatch(tr);
}

type Modifiers = { mod?: boolean, ctrl?: boolean, shift?: boolean, alt?: boolean };

/** Sends the key to the editor, like a real keypress. Returns whether the editor handled it. */
function press(editor: Editor, key: string, modifiers: Modifiers = {}): boolean {
  let event = new KeyboardEvent("keydown", {
    key,
    ctrlKey: modifiers.ctrl || (modifiers.mod && !isMacOS()),
    metaKey: modifiers.mod && isMacOS(),
    shiftKey: !!modifiers.shift,
    altKey: !!modifiers.alt,
    bubbles: true,
    cancelable: true,
  });
  let view = editor.view;
  return !!view.someProp("handleKeyDown", handler => handler(view, event));
}

/** Types the text character by character, so that input rules and autolink run. */
function type(editor: Editor, text: string) {
  for (let char of text) {
    let view = editor.view;
    let { from, to } = view.state.selection;
    let handled = view.someProp("handleTextInput", handler =>
      handler(view, from, to, char, () => view.state.tr.insertText(char, from, to)));
    if (!handled) {
      view.dispatch(view.state.tr.insertText(char, from, to));
    }
  }
}

/**
 * The HTML, without the empty paragraph that StarterKit's TrailingNode adds
 * when a list or heading is at the end of the document.
 */
function html(editor: Editor): string {
  return editor.getHTML().replace(/<p><\/p>$/, "");
}

function cursor(editor: Editor): number {
  expect(editor.state.selection.empty).toBe(true);
  return editor.state.selection.from;
}

describe("Character formatting", () => {
  test("Ctrl+B inside a word makes the whole word bold, and the cursor stays", () => {
    let editor = showEditor("<p>Hello wo|rld</p>");
    let before = cursor(editor);

    expect(press(editor, "b", { mod: true })).toBe(true);
    expect(html(editor)).toBe("<p>Hello <strong>world</strong></p>");
    expect(cursor(editor)).toBe(before);

    press(editor, "b", { mod: true });
    expect(html(editor)).toBe("<p>Hello world</p>");
  });

  test("Ctrl+B at the end of a word only applies to the text typed next", () => {
    let editor = showEditor("<p>Hello world|</p>");

    press(editor, "b", { mod: true });
    expect(html(editor)).toBe("<p>Hello world</p>");
    type(editor, "!");
    expect(html(editor)).toBe("<p>Hello world<strong>!</strong></p>");
  });

  test("Ctrl+B at the start of a word and between spaces doesn't touch the word", () => {
    let editor = showEditor("<p>Hello |world</p>");
    press(editor, "b", { mod: true });
    expect(html(editor)).toBe("<p>Hello world</p>");

    editor = showEditor("<p>Hello | world</p>");
    press(editor, "b", { mod: true });
    expect(html(editor)).toBe("<p>Hello  world</p>");
  });

  test("A word with an apostrophe or digits counts as one word", () => {
    let editor = showEditor("<p>It's do|n't 2nd</p>");
    press(editor, "b", { mod: true });
    expect(html(editor)).toBe("<p>It's <strong>don't</strong> 2nd</p>");

    editor = showEditor("<p>the 2|nd</p>");
    press(editor, "b", { mod: true });
    expect(html(editor)).toBe("<p>the <strong>2nd</strong></p>");
  });

  test("Ctrl+B on a partly bold selection makes all of it bold, and again removes it", () => {
    let editor = showEditor("<p>[Hello <strong>wor]ld</strong></p>");

    press(editor, "b", { mod: true });
    expect(html(editor)).toBe("<p><strong>Hello world</strong></p>");

    press(editor, "b", { mod: true });
    expect(html(editor)).toBe("<p>Hello wor<strong>ld</strong></p>");
  });

  test("Ctrl+I, Ctrl+U and Ctrl+Shift+S use the word at the cursor, too", () => {
    let editor = showEditor("<p>one t|wo three</p>");
    press(editor, "i", { mod: true });
    expect(html(editor)).toBe("<p>one <em>two</em> three</p>");

    editor = showEditor("<p>one t|wo three</p>");
    press(editor, "u", { mod: true });
    expect(html(editor)).toBe("<p>one <u>two</u> three</p>");

    editor = showEditor("<p>one t|wo three</p>");
    press(editor, "S", { mod: true, shift: true });
    expect(html(editor)).toBe("<p>one <s>two</s> three</p>");
  });

  test("The toolbar's command uses the word at the cursor", () => {
    let editor = showEditor("<p>one t|wo three</p>");

    editor.chain().focus().toggleMarkOnWord("code").run();
    expect(html(editor)).toBe("<p>one <code>two</code> three</p>");
  });

  test("Ctrl+Space clears the formatting of the word, but keeps the link", () => {
    let editor = showEditor(`<p><a href="https://example.com/"><strong><em>bo|ld</em></strong></a> text</p>`);

    expect(press(editor, " ", { ctrl: true })).toBe(true);
    expect(html(editor)).toBe(`<p><a href="https://example.com/">bold</a> text</p>`);
  });

  test("Ctrl+Space clears the formatting of the selection", () => {
    let editor = showEditor("<p>[<em>one</em> <strong>two</strong> <u>thr]ee</u></p>");

    press(editor, " ", { ctrl: true });
    expect(html(editor)).toBe("<p>one two thr<u>ee</u></p>");
  });

  test("Ctrl+Space at the end of a bold word makes the text typed next plain", () => {
    let editor = showEditor("<p><strong>bold|</strong></p>");

    press(editor, " ", { ctrl: true });
    type(editor, "x");
    expect(html(editor)).toBe("<p><strong>bold</strong>x</p>");
  });
});

describe("Alignment and paragraph style", () => {
  test("Ctrl+E centers, and again goes back to left", () => {
    let editor = showEditor("<p>Te|xt</p>");

    expect(press(editor, "e", { mod: true })).toBe(true);
    expect(html(editor)).toBe(`<p style="text-align: center;">Text</p>`);

    press(editor, "e", { mod: true });
    expect(html(editor)).toBe("<p>Text</p>");
  });

  test("Ctrl+R, Ctrl+J and Ctrl+L", () => {
    let editor = showEditor("<p>Te|xt</p>");

    press(editor, "r", { mod: true });
    expect(html(editor)).toBe(`<p style="text-align: right;">Text</p>`);
    press(editor, "j", { mod: true });
    expect(html(editor)).toBe(`<p style="text-align: justify;">Text</p>`);
    press(editor, "l", { mod: true });
    expect(html(editor)).toBe("<p>Text</p>");
    press(editor, "l", { mod: true });
    expect(html(editor)).toBe("<p>Text</p>");
  });

  test("Ctrl+E is not inline code anymore", () => {
    let editor = showEditor("<p>Te|xt</p>");

    press(editor, "e", { mod: true });
    expect(html(editor)).not.toContain("<code>");
  });

  test("Alignment works on headings, and on all paragraphs of the selection", () => {
    let editor = showEditor("<h2>Ti|tle</h2>");
    press(editor, "r", { mod: true });
    expect(html(editor)).toBe(`<h2 style="text-align: right;">Title</h2>`);

    // Only one of them is centered, so the key centers both
    editor = showEditor(`<p>[one</p><p style="text-align: center">tw]o</p>`);
    press(editor, "e", { mod: true });
    expect(html(editor)).toBe(`<p style="text-align: center;">one</p><p style="text-align: center;">two</p>`);
    press(editor, "e", { mod: true });
    expect(html(editor)).toBe("<p>one</p><p>two</p>");
  });

  test("Alignment is read from style and align attributes", () => {
    let editor = showEditor(`<p style="text-align: center">a</p><p align="right">b</p><h1 align="justify">c</h1>`);
    expect(html(editor)).toBe(`<p style="text-align: center;">a</p><p style="text-align: right;">b</p><h1 style="text-align: justify;">c</h1>`);

    // Left is the default, so it's not stored
    editor = showEditor(`<p style="text-align: left">a</p><p align="left">b</p>`);
    expect(html(editor)).toBe("<p>a</p><p>b</p>");
  });

  test("Ctrl+Shift+N turns a heading into a normal paragraph", () => {
    let editor = showEditor("<h2>Ti|tle</h2>");

    expect(press(editor, "N", { mod: true, shift: true })).toBe(true);
    expect(html(editor)).toBe("<p>Title</p>");
  });
});

describe("List keys", () => {
  test("Ctrl+Shift+L toggles a bulleted list", () => {
    let editor = showEditor("<p>It|em</p>");

    expect(press(editor, "L", { mod: true, shift: true })).toBe(true);
    expect(html(editor)).toBe("<ul><li><p>Item</p></li></ul>");

    press(editor, "L", { mod: true, shift: true });
    expect(html(editor)).toBe("<p>Item</p>");
  });

  test("Ctrl+. makes a bulleted list, Ctrl+/ a numbered list", () => {
    let editor = showEditor("<p>It|em</p>");
    press(editor, ".", { mod: true });
    expect(html(editor)).toBe("<ul><li><p>Item</p></li></ul>");

    editor = showEditor("<p>It|em</p>");
    press(editor, "/", { mod: true });
    expect(html(editor)).toBe("<ol><li><p>Item</p></li></ol>");
  });

  test("Tab inside the text of an item inserts spaces, Tab at the start of the item indents it", () => {
    let editor = showEditor("<ul><li><p>one</p></li><li><p>tw|o</p></li></ul>");
    expect(press(editor, "Tab")).toBe(true);
    expect(html(editor)).toBe("<ul><li><p>one</p></li><li><p>tw    o</p></li></ul>");

    editor = showEditor("<ul><li><p>one</p></li><li><p>|two</p></li></ul>");
    press(editor, "Tab");
    expect(html(editor)).toBe("<ul><li><p>one</p><ul><li><p>two</p></li></ul></li></ul>");
    press(editor, "Tab", { shift: true });
    expect(html(editor)).toBe("<ul><li><p>one</p></li><li><p>two</p></li></ul>");
  });

  test.skipIf(isMacOS())("Alt+Shift+Right / Left demote and promote the item, wherever the cursor is", () => {
    let editor = showEditor("<ul><li><p>one</p></li><li><p>tw|o</p></li></ul>");

    expect(press(editor, "ArrowRight", { alt: true, shift: true })).toBe(true);
    expect(html(editor)).toBe("<ul><li><p>one</p><ul><li><p>two</p></li></ul></li></ul>");

    expect(press(editor, "ArrowLeft", { alt: true, shift: true })).toBe(true);
    expect(html(editor)).toBe("<ul><li><p>one</p></li><li><p>two</p></li></ul>");
  });

  test("Ctrl+T / Ctrl+Shift+T demote and promote the item", () => {
    let editor = showEditor("<ol><li><p>one</p></li><li><p>tw|o</p></li></ol>");

    press(editor, "t", { mod: true });
    expect(html(editor)).toBe("<ol><li><p>one</p><ol><li><p>two</p></li></ol></li></ol>");

    press(editor, "T", { mod: true, shift: true });
    expect(html(editor)).toBe("<ol><li><p>one</p></li><li><p>two</p></li></ol>");
  });

  test("Backspace at the start of an item joins it into the item before, and the list stays one list", () => {
    let editor = showEditor("<ol><li><p>one</p></li><li><p>|two</p></li><li><p>three</p></li></ol>");

    expect(press(editor, "Backspace")).toBe(true);
    expect(html(editor)).toBe("<ol><li><p>one</p><p>two</p></li><li><p>three</p></li></ol>");
    // The cursor stays at the start of "two"
    expect(editor.state.selection.$from.parentOffset).toBe(0);
    expect(editor.state.selection.$from.parent.textContent).toBe("two");
  });

  test("Backspace at the start of item 2 of 2", () => {
    let editor = showEditor("<ul><li><p>one</p></li><li><p>|two</p></li></ul>");

    press(editor, "Backspace");
    expect(html(editor)).toBe("<ul><li><p>one</p><p>two</p></li></ul>");
  });

  test("Backspace at the start of the first item takes it out of the list", () => {
    let editor = showEditor("<ul><li><p>|one</p></li><li><p>two</p></li></ul>");

    press(editor, "Backspace");
    expect(html(editor)).toBe("<p>one</p><ul><li><p>two</p></li></ul>");
  });

  test("Backspace inside the text of an item deletes a character as usual", () => {
    let editor = showEditor("<ul><li><p>one</p></li><li><p>t|wo</p></li></ul>");

    expect(press(editor, "Backspace")).toBe(false);
  });
});

describe("Lists while typing", () => {
  test("* , - and + at the start of a paragraph make a bulleted list", () => {
    for (let trigger of ["* ", "- ", "+ "]) {
      let editor = showEditor("<p>|</p>");
      type(editor, trigger);
      expect(html(editor)).toBe("<ul><li><p></p></li></ul>");
    }
  });

  test("* at the start of a line after a line break splits the line off into a list", () => {
    let editor = showEditor("<p>Text<br>|</p>");

    type(editor, "* ");
    expect(html(editor)).toBe("<p>Text</p><ul><li><p></p></li></ul>");
    type(editor, "Item");
    expect(html(editor)).toBe("<p>Text</p><ul><li><p>Item</p></li></ul>");
  });

  test("* before existing text of a line makes that text the item", () => {
    let editor = showEditor("<p>Text<br>|more</p>");

    type(editor, "* ");
    expect(html(editor)).toBe("<p>Text</p><ul><li><p>more</p></li></ul>");
  });

  test("Only the line with the * goes into the list, not the lines after it", () => {
    let editor = showEditor("<p>Text<br>|more<br>after</p>");

    type(editor, "* ");
    expect(html(editor)).toBe("<p>Text</p><ul><li><p>more</p></li></ul><p>after</p>");
  });

  test("1. and 1) make a numbered list", () => {
    for (let trigger of ["1. ", "1) "]) {
      let editor = showEditor("<p>|</p>");
      type(editor, trigger);
      expect(html(editor)).toBe("<ol><li><p></p></li></ol>");
    }
  });

  test("Other numbers start the list with that number", () => {
    let editor = showEditor("<p>|</p>");

    type(editor, "3. ");
    expect(html(editor)).toBe(`<ol start="3"><li><p></p></li></ol>`);
  });

  test("a. A. i. I. a) make lettered and roman lists", () => {
    let cases = { "a. ": "a", "A. ": "A", "i. ": "i", "I. ": "I", "a) ": "a" };
    for (let [trigger, listType] of Object.entries(cases)) {
      let editor = showEditor("<p>|</p>");
      type(editor, trigger);
      expect(html(editor)).toBe(`<ol type="${listType}"><li><p></p></li></ol>`);
    }
  });

  test("A number that continues the list before joins that list", () => {
    let editor = showEditor("<ol><li><p>one</p></li><li><p>two</p></li></ol><p>|</p>");

    type(editor, "3. ");
    expect(html(editor)).toBe("<ol><li><p>one</p></li><li><p>two</p></li><li><p></p></li></ol>");
  });

  test("A number that doesn't continue the list before starts a new list", () => {
    let editor = showEditor("<ol><li><p>one</p></li><li><p>two</p></li></ol><p>|</p>");

    type(editor, "1. ");
    expect(html(editor)).toBe("<ol><li><p>one</p></li><li><p>two</p></li></ol><ol><li><p></p></li></ol>");
  });

  test("A bullet after a bulleted list joins it", () => {
    let editor = showEditor("<ul><li><p>one</p></li></ul><p>|</p>");

    type(editor, "* ");
    expect(html(editor)).toBe("<ul><li><p>one</p></li><li><p></p></li></ul>");
  });

  test("The list trigger in the middle of a line stays text", () => {
    let editor = showEditor("<p>Text |</p>");

    type(editor, "* 1. a. ");
    expect(html(editor)).toBe("<p>Text * 1. a. </p>");
  });

  test("Backspace right after the list was made undoes it", () => {
    let editor = showEditor("<p>|</p>");
    type(editor, "* ");
    expect(press(editor, "Backspace")).toBe(true);
    expect(html(editor)).toBe("<p>* </p>");

    editor = showEditor("<p>Text<br>|more</p>");
    type(editor, "1) ");
    press(editor, "Backspace");
    expect(html(editor)).toBe("<p>Text<br>1) more</p>");
  });

  test("A list at the end of the document gets the empty paragraph after it with the next change", () => {
    let editor = showEditor("<p>|</p>");

    type(editor, "* ");
    expect(editor.getHTML()).toBe("<ul><li><p></p></li></ul>");
    type(editor, "x");
    expect(editor.getHTML()).toBe("<ul><li><p>x</p></li></ul><p></p>");
  });
});

describe("Links", () => {
  test("applyLink() links the word at the cursor", () => {
    let editor = showEditor("<p>Hello wo|rld</p>");
    let before = cursor(editor);

    editor.commands.applyLink("https://example.com/");
    expect(html(editor)).toBe(`<p>Hello <a href="https://example.com/">world</a></p>`);
    expect(cursor(editor)).toBe(before);
  });

  test("applyLink() links the selection", () => {
    let editor = showEditor("<p>[Hello wo]rld</p>");

    editor.commands.applyLink("https://example.com/");
    expect(html(editor)).toBe(`<p><a href="https://example.com/">Hello wo</a>rld</p>`);
  });

  test("applyLink() with the cursor in a link changes the address of the whole link", () => {
    let editor = showEditor(`<p>See <a href="https://old.example/">the l|ink</a> here</p>`);

    editor.commands.applyLink("https://new.example/");
    expect(html(editor)).toBe(`<p>See <a href="https://new.example/">the link</a> here</p>`);
  });

  test("applyLink() without a word inserts the address, and the text typed after it is not linked", () => {
    let editor = showEditor("<p>See |</p>");

    editor.commands.applyLink("https://example.com/");
    expect(html(editor)).toBe(`<p>See <a href="https://example.com/">https://example.com/</a></p>`);
    type(editor, " more");
    expect(html(editor)).toBe(`<p>See <a href="https://example.com/">https://example.com/</a> more</p>`);
  });

  test("applyLink() with an empty address removes the link", () => {
    let editor = showEditor(`<p>See <a href="https://example.com/">the l|ink</a> here</p>`);

    editor.commands.applyLink("");
    expect(html(editor)).toBe("<p>See the link here</p>");
  });

  test("Typed addresses become links only with a scheme, www. or an @", () => {
    let editor = showEditor("<p>|</p>");
    type(editor, "Read readme.md and example.com now");
    expect(html(editor)).not.toContain("<a");

    editor = showEditor("<p>|</p>");
    type(editor, "Go to www.example.com now");
    expect(html(editor)).toMatch(/<a href="[a-z]+:\/\/www\.example\.com\/?">www\.example\.com<\/a> now/);

    editor = showEditor("<p>|</p>");
    type(editor, "Go to https://example.com/page now");
    expect(html(editor)).toContain(`<a href="https://example.com/page">https://example.com/page</a> now`);

    editor = showEditor("<p>|</p>");
    type(editor, "Mail fred@example.com now");
    expect(html(editor)).toContain(`<a href="mailto:fred@example.com">fred@example.com</a> now`);
  });

  function clickLink(editor: Editor, modifiers: Modifiers): boolean {
    let anchor = editor.view.dom.querySelector("a");
    let event = new MouseEvent("click", {
      button: 0,
      ctrlKey: !!modifiers.ctrl,
      metaKey: !!modifiers.mod,
      bubbles: true,
    });
    Object.defineProperty(event, "target", { value: anchor });
    let view = editor.view;
    let pos = view.posAtDOM(anchor, 0) + 1;
    return !!view.someProp("handleClick", handler => handler(view, pos, event));
  }

  test("Ctrl+Click and Cmd+Click open the link", () => {
    let open = vi.spyOn(window, "open").mockImplementation(() => null);
    let editor = showEditor(`<p>See <a href="https://example.com/">link</a></p>`);

    expect(clickLink(editor, { ctrl: true })).toBe(true);
    expect(open).toHaveBeenCalledWith("https://example.com/", "_blank");

    open.mockClear();
    expect(clickLink(editor, { mod: true })).toBe(true);
    expect(open).toHaveBeenCalledOnce();
  });

  test("A plain click on a link only places the cursor", () => {
    let open = vi.spyOn(window, "open").mockImplementation(() => null);
    let editor = showEditor(`<p>See <a href="https://example.com/">link</a></p>`);

    expect(clickLink(editor, {})).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });

  test("Ctrl+K does nothing when there's no toolbar to edit the link", () => {
    let editor = showEditor("<p>Hello wo|rld</p>");

    expect(press(editor, "k", { mod: true })).toBe(false);
  });

  async function showToolbar(editor: Editor): Promise<HTMLInputElement | null> {
    let target = document.createElement("div");
    document.body.append(target);
    mounted.push(mount(HTMLEditorToolbar, { target, props: { editor } }));
    flushSync();
    await tick();
    return document.querySelector<HTMLInputElement>("#linktargeturl");
  }

  async function openLinkField(editor: Editor): Promise<HTMLInputElement> {
    expect(press(editor, "k", { mod: true })).toBe(true);
    await tick();
    flushSync();
    await tick();
    let input = document.querySelector<HTMLInputElement>("#linktargeturl");
    expect(input).not.toBe(null);
    return input;
  }

  function keyInField(input: HTMLInputElement, key: string) {
    input.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    flushSync();
  }

  test("Ctrl+K opens the link field with the focus in it, and Enter links the word at the cursor", async () => {
    let editor = showEditor("<p>Hello wo|rld</p>");
    expect(await showToolbar(editor)).toBe(null);

    let input = await openLinkField(editor);
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe("");

    input.value = " https://example.com/ ";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    keyInField(input, "Enter");
    expect(html(editor)).toBe(`<p>Hello <a href="https://example.com/">world</a></p>`);
    expect(document.querySelector("#linktargeturl")).toBe(null);
  });

  test("Ctrl+K in a link shows its address, and Esc closes the field without a change", async () => {
    let editor = showEditor(`<p>See <a href="https://example.com/">the l|ink</a></p>`);
    await showToolbar(editor);

    let input = await openLinkField(editor);
    expect(input.value).toBe("https://example.com/");

    input.value = "https://changed.example/";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    keyInField(input, "Escape");
    expect(document.querySelector("#linktargeturl")).toBe(null);
    expect(html(editor)).toBe(`<p>See <a href="https://example.com/">the link</a></p>`);
  });
});
