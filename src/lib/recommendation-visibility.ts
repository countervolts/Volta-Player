export function observeRecommendationVisibility(
  root: Element,
  onVisible: (position: number) => void,
) {
  const cards = [...root.querySelectorAll(".album-card")];
  const visible = new Set<Element>();
  const recorded = new Set<Element>();
  const timers = new Map<Element, ReturnType<typeof setTimeout>>();
  const cancel = (card: Element) => {
    clearTimeout(timers.get(card));
    timers.delete(card);
  };
  const blocked = () => document.visibilityState !== "visible" ||
    Boolean(document.querySelector('[role="dialog"], dialog[open]'));
  const schedule = (card: Element) => {
    if (blocked() || recorded.has(card) || timers.has(card)) return;
    timers.set(card, setTimeout(() => {
      timers.delete(card);
      if (blocked() || !visible.has(card)) return;
      recorded.add(card);
      onVisible(cards.indexOf(card));
    }, 1000));
  };
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting && entry.intersectionRatio >= 0.5) {
        visible.add(entry.target);
        schedule(entry.target);
      } else {
        visible.delete(entry.target);
        cancel(entry.target);
      }
    }
  }, { threshold: [0, 0.5] });
  cards.forEach((card) => observer.observe(card));
  const refresh = () => {
    cards.forEach(cancel);
    visible.forEach(schedule);
  };
  document.addEventListener("visibilitychange", refresh);
  // Dialog mount/unmount can cover a card without changing its intersection.
  const dialogs = new MutationObserver((entries) => {
    if (entries.some((entry) => [...entry.addedNodes, ...entry.removedNodes].some(
      (node) => node instanceof Element && (node.matches('[role="dialog"], dialog') || node.querySelector('[role="dialog"], dialog')),
    ))) refresh();
  });
  dialogs.observe(document.body, { childList: true, subtree: true });
  return () => {
    observer.disconnect();
    dialogs.disconnect();
    document.removeEventListener("visibilitychange", refresh);
    cards.forEach(cancel);
  };
}
