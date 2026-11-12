import {expect, it} from "vitest";
import {renderToStaticMarkup} from "react-dom/server";
import {MemoryRouter} from "react-router-dom";
import {HeaderBrand} from "../src/AppHeader";

it.each(["/", "/?filter=active"])("keeps the project list brand inert: %s", path => {
    const html = renderToStaticMarkup(<MemoryRouter initialEntries={[path]}><HeaderBrand/></MemoryRouter>);
    expect(html).toContain('<b class="header-brand">SunwiseMatriX TR</b>');
    expect(html).not.toContain("href=");
});

it.each(["/projects/p", "/projects/p/review", "/projects/p/requirement-diff"])("links the brand to the project list: %s", path => {
    const html = renderToStaticMarkup(<MemoryRouter initialEntries={[path]}><HeaderBrand/></MemoryRouter>);
    expect(html).toContain('href="/"');
    expect(html).toContain('class="browse-link header-brand"');
});
