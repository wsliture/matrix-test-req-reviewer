import {useEffect} from "react";

export function setProjectPageTitle(target: Pick<Document, "title">, projectName: string | undefined, page: string) {
    const previous = target.title;
    target.title = projectName ? `${projectName} · ${page}` : `${page} · SunwiseMatriX TR`;
    return () => { target.title = previous };
}

export function useProjectPageTitle(projectName: string | undefined, page: string) {
    useEffect(() => setProjectPageTitle(document, projectName, page), [projectName, page]);
}
