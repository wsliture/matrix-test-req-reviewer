export type RunWarningDetails = {warnings: string[]; skippedCount: number};

function readableWarning(value: unknown) {
    if (typeof value === "string") return value.trim();
    try {
        const serialized = JSON.stringify(value);
        return serialized === undefined ? String(value) : serialized
    } catch { return String(value) }
}

export function runWarningDetails(payload: Record<string, unknown>): RunWarningDetails {
    const warnings = Array.isArray(payload.warnings) ? payload.warnings.map(readableWarning).filter(Boolean) : [];
    const rawSkipped = typeof payload.skipped_count === "number" ? payload.skipped_count : Number.NaN;
    const skippedCount = Number.isFinite(rawSkipped) && rawSkipped >= 0 ? Math.floor(rawSkipped) : 0;
    return {warnings, skippedCount}
}

export function toggleExpandedEvent(ids: ReadonlySet<string>, eventId: string) {
    const next = new Set(ids);
    if (next.has(eventId)) next.delete(eventId);
    else next.add(eventId);
    return next
}

export function isExpansionKey(key: string) {
    return key === "Enter" || key === " "
}
