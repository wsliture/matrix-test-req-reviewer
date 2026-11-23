import {isIP} from "node:net";
import {BadRequestException} from "@nestjs/common";

export const MATRIX_ENDPOINT = Symbol("matrixPlanningEndpoint");

export function normalizeMatrixAddress(value: unknown): string {
    if (typeof value !== "string") throw new BadRequestException("请输入 Matrix 回调基地址");
    const input = value.trim();
    if (!input) return "";
    const authority = /^https?:\/\/(\[[^\]]+\]|[^/:?#]+)(?::\d+)?(?:\/|$)/i.exec(input);
    const address = URL.canParse(input) ? new URL(input) : null;
    if (!authority || !isIP(authority[1].replace(/^\[|\]$/g, "")) || !address ||
        address.username || address.password || /[?#\\\s]/.test(input)) {
        throw new BadRequestException("请输入带 IP 地址的 HTTP 或 HTTPS 回调基地址");
    }
    return address.href.replace(/\/+$/, "");
}

export function normalizeIp(value: string): string {
    const ip = value.replace(/^\[|\]$/g, "").toLowerCase();
    if (ip.startsWith("::ffff:") && isIP(ip.slice(7)) === 4) return ip.slice(7);
    if (isIP(ip) !== 6) return ip;
    const canonical = new URL(`http://[${ip}]`).hostname.slice(1, -1);
    const mapped = /^::ffff:([\da-f]+):([\da-f]+)$/.exec(canonical);
    if (!mapped) return canonical;
    const [high, low] = mapped.slice(1).map(part => parseInt(part, 16));
    return [high >> 8, high & 255, low >> 8, low & 255].join(".");
}

export function matrixSourceIp(peer: string, forwarded: unknown, trusted: string): string {
    const source = normalizeIp(peer);
    if (!trusted.split(",").map(ip => normalizeIp(ip.trim())).includes(source)) return source;
    return typeof forwarded === "string" && isIP(forwarded) ? normalizeIp(forwarded) : "";
}
