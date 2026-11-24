import {
    Body,
    BadRequestException,
    CanActivate,
    Controller,
    ExecutionContext,
    Get,
    Injectable,
    Post,
    Req,
    Res,
    UnauthorizedException
} from "@nestjs/common";
import {PrismaService} from "./prisma.js";
import {hash, verify} from "argon2";
import {jwtVerify, SignJWT} from "jose";

import {MATRIX_ENDPOINT} from "./matrix-settings.js";
import {MATRIX_ANONYMOUS_USER, MATRIX_ANONYMOUS_USER_ID, MATRIX_PROJECT_ACCESS, MatrixProjectAccess,
    type MatrixResource} from "./matrix-project-access.js";

const secret = () => new TextEncoder().encode(process.env.JWT_SECRET || "development-secret-change-me-now");
const secureCookies = () => process.env.COOKIE_SECURE?.trim().toLowerCase() === "true";
const ACCESS_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;
const cookieOptions = (path: string, maxAge?: number) => ({
    httpOnly: true,
    sameSite: "lax" as const,
    secure: secureCookies(),
    path,
    ...(maxAge ? {maxAge} : {})
});

@Injectable()
export class AuthGuard implements CanActivate {
    constructor(private db: PrismaService) {}

    async canActivate(context: ExecutionContext) {
        const request = context.switchToHttp().getRequest();
        const route = request.url?.split("?")[0].replace(/\/$/, "");
        const integration = Reflect.getMetadata(MATRIX_ENDPOINT, context.getClass()) === true;
        if (integration) return true;
        if (request.method === "POST" && ["/api/auth/login", "/api/auth/logout"].includes(route)) return true;
        const token = request.cookies?.access_token;
        if (token) {
            const session = await jwtVerify(token, secret()).catch(() => null);
            if (session && session.payload.sub !== MATRIX_ANONYMOUS_USER_ID) {
                request.user = {id: String(session.payload.sub), role: session.payload.role};
                return true;
            }
        }
        const access = Reflect.getMetadata(MATRIX_PROJECT_ACCESS, context.getHandler()) as
            {param: string; resource: MatrixResource} | undefined;
        if (access) {
            const id = request.params?.[access.param];
            if (typeof id === "string" && await this.isMatrixProject(id, access.resource)) {
                request.user = MATRIX_ANONYMOUS_USER;
                return true;
            }
        }
        throw new UnauthorizedException(token ? "登录已过期" : undefined);
    }

    private async isMatrixProject(id: string, resource: MatrixResource) {
        const project = {source: "MATRIX" as const};
        const select = {id: true};
        switch (resource) {
            case "project": return this.db.project.findFirst({where: {id, ...project}, select});
            case "document": return this.db.document.findFirst({where: {id, project}, select});
            case "run": return this.db.phase2Run.findFirst({where: {id, project}, select});
            case "editRun": return this.db.phase2EditRun.findFirst({where: {id, project}, select});
        }
    }
}

@Injectable()
export class AuthService {
    constructor(private db: PrismaService) {
    }

    private signAccessToken(user: {id: string; role: string}) {
        return new SignJWT({role: user.role}).setProtectedHeader({alg: "HS256"}).setSubject(user.id)
            .setExpirationTime(`${ACCESS_TOKEN_TTL_SECONDS}s`).sign(secret())
    }

    async login(username: string, password: string) {
        const user = await this.db.user.findUnique({where: {username}});
        if (!user || user.id === MATRIX_ANONYMOUS_USER_ID || !await verify(user.passwordHash, password)) throw new UnauthorizedException("用户名或密码错误");
        return {
            user: {id: user.id, username: user.username, role: user.role},
            access: await this.signAccessToken(user)
        }
    }

    async current(userId: string) {
        return this.db.user.findUniqueOrThrow({
            where: {id: userId},
            select: {id: true, username: true, role: true}
        })
    }

    async changePassword(userId: string, currentPassword: string, newPassword: string) {
        if (userId === MATRIX_ANONYMOUS_USER_ID) throw new UnauthorizedException();
        if (typeof newPassword !== "string" || newPassword.length < 8 || newPassword.length > 128) {
            throw new BadRequestException("新密码长度必须为8至128个字符")
        }
        const user = await this.db.user.findUniqueOrThrow({where: {id: userId}});
        if (!await verify(user.passwordHash, currentPassword)) throw new UnauthorizedException("当前密码错误");
        if (await verify(user.passwordHash, newPassword)) throw new BadRequestException("新密码不能与当前密码相同");
        await this.db.$transaction([
            this.db.user.update({where: {id: userId}, data: {passwordHash: await hash(newPassword)}}),
            this.db.auditLog.create({data: {userId, action: "PASSWORD_CHANGED", resourceType: "User", resourceId: userId}})
        ]);
        return {ok: true}
    }
}

@Controller("auth")
export class AuthController {
    constructor(private auth: AuthService) {
    }

    @Post("login") async login(@Body() body: {
        username: string,
        password: string
    }, @Res({passthrough: true}) res: any) {
        const result = await this.auth.login(body.username, body.password);
        res.setCookie("access_token", result.access, cookieOptions("/", ACCESS_TOKEN_TTL_SECONDS));
        return result.user
    }

    @Post("logout") logout(@Res({passthrough: true}) res: any) {
        res.clearCookie("access_token", cookieOptions("/"));
        return {ok: true}
    }

    @Post("change-password") async changePassword(@Req() req: any, @Body() body: {
        currentPassword: string,
        newPassword: string
    }, @Res({passthrough: true}) res: any) {
        const result = await this.auth.changePassword(req.user.id, body.currentPassword, body.newPassword);
        res.clearCookie("access_token", cookieOptions("/"));
        return result
    }

    @Get("projects/:projectId")
    @MatrixProjectAccess("projectId")
    projectIdentity(@Req() req: any) {
        return req.user.service ? MATRIX_ANONYMOUS_USER : this.auth.current(req.user.id);
    }

    @Get("me") me(@Req() req: any) {
        return this.auth.current(req.user.id)
    }
}
