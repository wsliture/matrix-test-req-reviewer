export function formatTokenCount(value: number): string {
    if (value < 1000) return Math.round(value).toLocaleString("en-US");
    if (value < 1_000_000) return `${(value / 1000).toFixed(1)}K`;
    return `${(value / 1_000_000).toFixed(1)}M`
}

export function elapsedMilliseconds(startedAt?: string, finishedAt?: string, now = Date.now()): number {
    if (!startedAt) return 0;
    const start = new Date(startedAt).getTime(), end = finishedAt ? new Date(finishedAt).getTime() : now;
    if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
    return Math.max(0, end - start)
}

export function formatElapsed(milliseconds: number): string {
    const seconds = Math.floor(milliseconds / 1000), hours = Math.floor(seconds / 3600),
        minutes = Math.floor(seconds % 3600 / 60), remainder = seconds % 60;
    return [hours, minutes, remainder].map(value => String(value).padStart(2, "0")).join(":")
}

export type TokenUsageValues = {input: number; output: number; reasoning: number; cacheRead: number};

export function nonCachedTokens(usage: TokenUsageValues): number {
    return usage.input + usage.output + usage.reasoning
}

export function cacheHitRate(usage: Pick<TokenUsageValues, "input" | "cacheRead">): number {
    const inputTotal = usage.input + usage.cacheRead;
    return inputTotal > 0 ? usage.cacheRead / inputTotal * 100 : 0
}
