export function isTextField(target: EventTarget | null): boolean {
  let element = target as HTMLElement;
  return !!element?.closest?.("input, textarea, select, [contenteditable]:not([contenteditable='false'])");
}

export function getKeyDigit(event: KeyboardEvent): number | null {
  let digit = /^(Digit|Numpad)(\d)$/.exec(event.code)?.[2];
  return digit ? parseInt(digit) : null;
}
