import type {Phase2Chapter} from "./api";

export type ChapterWarningPresentation = {warnings: string[]; skippedCount: number};

export function chapterWarningForBlock(chapter: Phase2Chapter, blockIndex: number): ChapterWarningPresentation | undefined {
    const warnings = (chapter.warnings || []).map(item => String(item).trim()).filter(Boolean);
    if (!warnings.length || chapter.blocks.findIndex(block => block.type === "heading") !== blockIndex) return undefined;
    const rawCount = Number(chapter.skippedCount);
    return {warnings, skippedCount: Number.isFinite(rawCount) && rawCount >= 0 ? Math.floor(rawCount) : 0}
}
