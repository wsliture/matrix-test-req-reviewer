import {describe, expect, it, vi} from "vitest";
import {renderToStaticMarkup} from "react-dom/server";
import {MemoryRouter} from "react-router-dom";
import {BrowseButton, BrowseLink, isPlainNavigation, navigationClick, pageHref, resolveReviewLocation, reviewHref} from "../src/navigation";
import type {MouseEvent} from "react";

const event = (overrides = {}) => ({button: 0, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false,
    defaultPrevented: false, stopPropagation: vi.fn(), preventDefault: vi.fn(), ...overrides}) as unknown as MouseEvent<HTMLAnchorElement>;

describe("native browse links", () => {
    it("preserves all navigation parameters in browsers without URLSearchParams.size", () => {
        const descriptor = Object.getOwnPropertyDescriptor(URLSearchParams.prototype, "size");
        try {
            Reflect.deleteProperty(URLSearchParams.prototype, "size");
            expect(new URLSearchParams("a=1").size).toBeUndefined();
            expect(reviewHref("p", {chapter: "4.1"})).toBe("/projects/p/review?chapter=4.1");
            const file = new URL(pageHref("/projects/p", {debugFile: ".matrix/中文 +#.json"}), "http://localhost");
            expect(file.searchParams.get("debugFile")).toBe(".matrix/中文 +#.json");
            const review = new URL(reviewHref("p", {requirementId: "r", documentId: "d", sourceNodeId: "s"}), "http://localhost");
            expect([...review.searchParams.entries()]).toEqual([["requirementId", "r"], ["documentId", "d"], ["sourceNodeId", "s"]]);
            expect(pageHref("/projects/p/requirement-diff", {from: "v1", to: "v2", entityUid: "r"}, "kind=MODIFIED"))
                .toBe("/projects/p/requirement-diff?kind=MODIFIED&from=v1&to=v2&entityUid=r");
            expect(pageHref("/projects/p", {debugFile: undefined}, "debugFile=old")).toBe("/projects/p");
        } finally {
            if (descriptor) Object.defineProperty(URLSearchParams.prototype, "size", descriptor);
        }
    });
    it("renders real links and removes disabled destinations", () => {
        const html = renderToStaticMarkup(<MemoryRouter><BrowseLink to="/projects/p">项目</BrowseLink><BrowseLink to="/hidden" disabled>未生成</BrowseLink></MemoryRouter>);
        expect(html).toContain('href="/projects/p"'); expect(html).not.toContain('href="/hidden"'); expect(html).toContain('aria-disabled="true"');
    });
    it("uses native Ant Design buttons and removes disabled hrefs", () => {
        const html = renderToStaticMarkup(<MemoryRouter><BrowseButton to="/projects/p" type="primary">打开</BrowseButton><BrowseButton to="/hidden" disabled>上一项</BrowseButton></MemoryRouter>);
        expect(html).toContain('href="/projects/p"');
        expect(html).toContain('ant-btn-primary');
        expect(html).not.toContain('href="/hidden"');
        expect(html).toContain('<button');
        expect(html).toContain('disabled');
    });
    it("guards ordinary navigation and preserves drafts when cancelled", () => {
        const click = event(), guard = vi.fn(() => false), follow = vi.fn();
        navigationClick(click, guard, follow);
        expect(guard).toHaveBeenCalledOnce(); expect(click.preventDefault).toHaveBeenCalledOnce(); expect(follow).not.toHaveBeenCalled();
        const allowed = event(); navigationClick(allowed, () => true, follow);
        expect(follow).toHaveBeenCalledOnce(); expect(allowed.preventDefault).not.toHaveBeenCalled();
    });
    it.each([{button: 1}, {button: 2}, {ctrlKey: true}, {metaKey: true}, {shiftKey: true}, {altKey: true}, {defaultPrevented: true}])("leaves browser gestures untouched: %j", overrides => {
        const click = event(overrides), guard = vi.fn(), follow = vi.fn(); navigationClick(click, guard, follow);
        expect(isPlainNavigation(click)).toBe(false); expect(guard).not.toHaveBeenCalled(); expect(follow).not.toHaveBeenCalled(); expect(click.preventDefault).not.toHaveBeenCalled();
    });
    it("encodes destinations and preserves independent context", () => {
        const href = reviewHref("项目/1", {requirementId: "r &+#", chapter: undefined}, "chapter=4.1&documentId=d&sourceNodeId=s");
        const url = new URL(href, "http://localhost");
        expect(url.pathname).toBe("/projects/%E9%A1%B9%E7%9B%AE%2F1/review");
        expect(url.searchParams.get("requirementId")).toBe("r &+#"); expect(url.searchParams.has("chapter")).toBe(false);
        expect(url.searchParams.get("sourceNodeId")).toBe("s");
        const debug = new URL(pageHref("/projects/p", {debugFile: ".matrix/中文 +#.json"}), "http://localhost");
        expect(debug.searchParams.get("debugFile")).toBe(".matrix/中文 +#.json");
    });
});

describe("review deep links", () => {
    const requirements = [{id: "r", nodeType: "requirement"}, {id: "c", nodeType: "section", number: "4.1"}];
    const documents = [{id: "d1", nodes: [{id: "s1"}]}, {id: "d2", nodes: [{id: "s2"}]}];
    it("restores both panes and gives a requirement precedence over chapter", () => {
        expect(resolveReviewLocation(new URLSearchParams("requirementId=r&chapter=4.1&documentId=d2&sourceNodeId=s2"), requirements, documents))
            .toEqual({requirementId: "r", documentId: "d2", sourceNodeId: "s2", invalidRequirement: false, invalidSource: false});
    });
    it("supports legacy chapters and source-only links", () => {
        expect(resolveReviewLocation(new URLSearchParams("chapter=4.1&sourceNodeId=s2"), requirements, documents)).toMatchObject({requirementId: "c", documentId: "d2", sourceNodeId: "s2"});
    });
    it("rejects cross-document nodes and invalid requirements without silently selecting another", () => {
        expect(resolveReviewLocation(new URLSearchParams("requirementId=missing&chapter=4.1&documentId=d1&sourceNodeId=s2"), requirements, documents))
            .toMatchObject({requirementId: undefined, sourceNodeId: undefined, invalidRequirement: true, invalidSource: true});
    });
    it("resolves independent history locations without stale selection", () => {
        const first = resolveReviewLocation(new URLSearchParams("requirementId=r&documentId=d2&sourceNodeId=s2"), requirements, documents);
        const second = resolveReviewLocation(new URLSearchParams("chapter=4.1"), requirements, documents);
        expect(first.sourceNodeId).toBe("s2"); expect(second).toMatchObject({requirementId: "c", documentId: "d1", sourceNodeId: undefined});
    });
});
