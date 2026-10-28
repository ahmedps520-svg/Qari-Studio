/** Helpers for global keyboard shortcuts. */
export const typingTarget = (e: KeyboardEvent) => {
  const el = e.target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
};

/** Space/Enter on a focused control already activates it; don't run a shortcut as well. */
export const activatesFocused = (e: KeyboardEvent) => {
  if (e.key !== ' ' && e.key !== 'Enter') return false;
  const el = e.target as HTMLElement | null;
  return !!el?.closest('button, a[href], [role="button"], [role="switch"], [role="radio"], [role="slider"], [role="menuitem"]');
};
