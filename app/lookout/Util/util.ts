export function getKeyDigit(event: KeyboardEvent): number | null {
  let digit = /^(Digit|Numpad)(\d)$/.exec(event.code)?.[2];
  return digit ? parseInt(digit) : null;
}
