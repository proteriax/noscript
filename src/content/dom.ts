export function bind(document: Document) {
  const $$: {
    <K extends keyof HTMLElementTagNameMap>(key: K): HTMLElementTagNameMap[K][]
  } = selector => Array.from(document.querySelectorAll(selector))

  return {
    $$,
  }
}
