import type { Store } from '@/app/store.js';
import type { ViewState } from '@/interact/view_state.js';

/**
 * Tiny subscription primitive. `bind(el, store, render)` re-renders the
 * element whenever the store fires. No virtual DOM — we mutate
 * textContent / value / classList directly. Every UI file goes through
 * these two helpers, which is what keeps a later signals-library swap
 * mechanical.
 */
export function bind<T extends Element>(
  el: T, store: Store, render: (el: T, view: ViewState) => void,
): () => void {
  return store.subscribe((view) => render(el, view));
}

/** Two-way bind: input → store and store → input (skipping the element
 *  the user is actively editing, so their keystrokes don't fight). */
export function bindInput(
  input: HTMLInputElement, store: Store,
  read: (view: ViewState) => string,
  write: (view: ViewState, value: string) => ViewState,
): () => void {
  const off = store.subscribe((view) => {
    if (input.ownerDocument.activeElement !== input) input.value = read(view);
  });
  const onInput = (): void => store.update((view) => write(view, input.value));
  input.addEventListener('input', onInput);
  return () => { off(); input.removeEventListener('input', onInput); };
}
