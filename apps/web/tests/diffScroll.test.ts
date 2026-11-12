import {expect, it, vi} from "vitest";
import {createDiffScrollSync, syncDiffScroll, isScrollKey} from "../src/diffScroll";
function pane(items: [string, number, number][], scrollTop = 0) {
 return {scrollTop, getBoundingClientRect: () => ({top: 0}), querySelectorAll: () => items.map(([uid, top, height]) => ({dataset: {entityUid: uid}, getBoundingClientRect: () => ({top, height})})), scrollTo: vi.fn()} as unknown as HTMLElement;
}
it("maps progress inside unequal tall rows", () => {
 const target = pane([["row", 100, 2000]], 500);
 syncDiffScroll(pane([["row", -410, 1000]]), target);
 expect(target.scrollTo).toHaveBeenCalledWith({top: 1510, behavior: "instant"});
});
it("matches canonical occurrences of duplicate entity annotations", () => {
 const target = pane([["row", 100, 1000], ["row", 200, 100]]);
 syncDiffScroll(pane([["row", -410, 1000], ["row", 50, 100]]), target);
 expect(target.scrollTo).toHaveBeenCalledWith({top: 510, behavior: "instant"});
});
it("skips missing counterparts", () => {
 const target = pane([["other", 0, 100]]);
 syncDiffScroll(pane([["deleted", 0, 100]]), target);
 expect(target.scrollTo).not.toHaveBeenCalled();
});
it("claims only scrolling keys", () => {
 expect(isScrollKey("PageDown")).toBe(true);
 expect(isScrollKey(" ")).toBe(true);
 expect(isScrollKey("Tab")).toBe(false);
});

it("ignores delayed follower events until new user input transfers ownership", () => {
 const left = pane([["row", -410, 1000]]), right = pane([["row", 100, 2000]]);
 const sync = createDiffScrollSync();
 sync.claim(left);
 sync.sync(left, right);
 expect(right.scrollTo).toHaveBeenCalledTimes(1);
 for (let i = 0; i < 10; i++) sync.sync(right, left);
 expect(left.scrollTo).not.toHaveBeenCalled();
 sync.claim(right);
 sync.sync(right, left);
 expect(left.scrollTo).toHaveBeenCalledTimes(1);
 sync.claim(null);
 sync.sync(left, right);
 sync.sync(right, left);
 expect(right.scrollTo).toHaveBeenCalledTimes(1);
 expect(left.scrollTo).toHaveBeenCalledTimes(1);
});
