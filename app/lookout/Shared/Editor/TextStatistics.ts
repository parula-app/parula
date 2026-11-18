import type { Editor } from "@tiptap/core";

export class TextStatistics {
  readonly words: number;
  readonly charactersWithoutSpaces: number;
  readonly charactersWithSpaces: number;
  readonly paragraphs: number;

  constructor(paragraphTexts: string[]) {
    let paragraphs = paragraphTexts.filter(text => text.trim());
    this.paragraphs = paragraphs.length;
    this.words = paragraphs.reduce((sum, text) => sum + text.split(/\s+/).filter(word => !!word).length, 0);
    this.charactersWithSpaces = paragraphs.reduce((sum, text) => sum + Array.from(text).length, 0);
    this.charactersWithoutSpaces = paragraphs.reduce((sum, text) => sum + Array.from(text.replace(/\s/g, "")).length, 0);
  }

  static ofEditor(editor: Editor): TextStatistics {
    let { doc, selection } = editor.state;
    let from = selection.empty ? 0 : selection.from;
    let to = selection.empty ? doc.content.size : selection.to;
    return new TextStatistics(doc.textBetween(from, to, "\n", " ").split("\n"));
  }
}
