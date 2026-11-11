// Small UI module, for timing. Also presses Escape, which the frame forwards to the app.
export default function (target: HTMLElement): () => void {
  let box = document.createElement("div");
  box.textContent = "Hello";
  target.appendChild(box);
  setTimeout(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })), 100);
  return () => box.remove();
}
