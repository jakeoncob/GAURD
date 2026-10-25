const guarded = new WeakSet();

/** Keep trackpad scroll/pinch over map labels from zooming the page or map. */
export function containPopupScroll(element) {
  if (guarded.has(element)) return;
  guarded.add(element);
  const contain = event => { event.preventDefault(); event.stopPropagation(); };
  for (const type of ['wheel', 'gesturestart', 'gesturechange']) {
    element.addEventListener(type, contain, { passive: false });
  }
}
