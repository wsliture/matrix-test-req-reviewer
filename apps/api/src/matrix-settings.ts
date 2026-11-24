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
