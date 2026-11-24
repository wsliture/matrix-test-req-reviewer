import {SetMetadata} from "@nestjs/common";

export const MATRIX_PROJECT_ACCESS = Symbol("matrixProjectAccess");
export const MATRIX_ANONYMOUS_USER_ID = "matrix-anonymous-system";
export const MATRIX_ANONYMOUS_USER = {
    id: MATRIX_ANONYMOUS_USER_ID,
    username: "Matrix 匿名访问",
    role: "REVIEWER",
    service: true
} as const;

export type MatrixResource = "project" | "document" | "run" | "editRun";

export const MatrixProjectAccess = (param: string, resource: MatrixResource = "project") =>
    SetMetadata(MATRIX_PROJECT_ACCESS, {param, resource});
