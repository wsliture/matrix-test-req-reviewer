export const isScrollKey = (key: string) => ["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(key);

export function createDiffScrollSync() {
    let owner: HTMLElement | null = null;
    return {
        claim(pane: HTMLElement | null) { owner = pane },
        sync(source: HTMLElement, target: HTMLElement | null) {
            if (target && owner === source) syncDiffScroll(source, target);
        }
    };
}

// Keep one canonical element per entity on both sides; nested/duplicate
// annotations must not match the last occurrence to the first occurrence.
function anchors(pane: HTMLElement) {
    const seen = new Set<string>();
    return [...pane.querySelectorAll<HTMLElement>("[data-entity-uid]")].filter(element => {
        const uid = element.dataset.entityUid;
        if (!uid || seen.has(uid)) return false;
        seen.add(uid);
        return true;
    });
}

export function syncDiffScroll(source: HTMLElement, target: HTMLElement) {
    const sourceTop = source.getBoundingClientRect().top;
    const targetTop = target.getBoundingClientRect().top;
    const reference = 90;
    const sourceAnchors = anchors(source), targetAnchors = anchors(target);
    const pairs = sourceAnchors.flatMap(element => {
        const counterpart = targetAnchors.find(item => item.dataset.entityUid === element.dataset.entityUid);
        return counterpart ? [{element, counterpart}] : [];
    });
    const current = pairs.filter(pair => pair.element.getBoundingClientRect().top <= sourceTop + reference).at(-1) || pairs[0];
    if (!current) return;
    const rect = current.element.getBoundingClientRect(), other = current.counterpart.getBoundingClientRect();
    const offset = sourceTop + reference - rect.top;
    // Preserve progress inside tall rows even when revisions wrap differently.
    const mappedOffset = offset >= 0 && offset <= rect.height && rect.height > 0
        ? offset / rect.height * other.height : offset;
    const top = target.scrollTop + other.top - targetTop + mappedOffset - reference;
    if (Math.abs(target.scrollTop - top) > .5) target.scrollTo({top, behavior: "instant"});
}
