/**
 * Tiny subscription primitive. `bind(el, store, render)` re-renders the
 * element whenever the store fires. No virtual DOM — we mutate
 * textContent / value / classList directly. Every UI file goes through
 * these two helpers, which is what keeps a later signals-library swap
 * mechanical.
 *
 * G12: generic over any Subscribable so the view Store and the
 * render-only RenderParamsStore bind through the same helpers — no casts.
 */
export interface Subscribable<V> {
  subscribe(cb: (v: V) => void): () => void;
  update(fn: (v: V) => V): void;
}

export function bind<T extends Element, V>(
  el: T, store: Pick<Subscribable<V>, 'subscribe'>,
  render: (el: T, view: V) => void,
): () => void {
  return store.subscribe((view) => render(el, view));
}

/** Two-way bind: input → store and store → input (skipping the element
 *  the user is actively editing, so their keystrokes don't fight). */
export function bindInput<V>(
  input: HTMLInputElement, store: Subscribable<V>,
  read: (view: V) => string,
  write: (view: V, value: string) => V,
): () => void {
  const off = store.subscribe((view) => {
    if (input.ownerDocument.activeElement !== input) input.value = read(view);
  });
  const onInput = (): void => store.update((view) => write(view, input.value));
  input.addEventListener('input', onInput);
  return () => { off(); input.removeEventListener('input', onInput); };
}
