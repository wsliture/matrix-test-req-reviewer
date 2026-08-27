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
import {createHash, randomBytes} from "node:crypto";

const secret = () => new TextEncoder().encode(process.env.JWT_SECRET || "development-secret-change-me-now");
const secureCookies = () => process.env.COOKIE_SECURE?.trim().toLowerCase() === "true";
const ACCESS_TOKEN_TTL_SECONDS = 30 * 60;
const refreshTokenTtlSeconds = (rememberMe: boolean) => (rememberMe ? 30 : 7) * 86400;
const cookieOptions = (path: string, maxAge?: number) => ({
    httpOnly: true,
    sameSite: "lax" as const,
    secure: secureCookies(),
    path,
    ...(maxAge ? {maxAge} : {})
});

@Injectable()
export class AuthGuard implements CanActivate {
    async canActivate(context: ExecutionContext) {
        const request = context.switchToHttp().getRequest();
        if (["/auth/login", "/auth/refresh", "/auth/logout"].some(path => request.url?.includes(path))) return true;
        const token = request.cookies?.access_token;
        if (!token) throw new UnauthorizedException();
        try {
            const {payload} = await jwtVerify(token, secret());
            request.user = {id: String(payload.sub), role: payload.role};
            return true
        } catch {
            throw new UnauthorizedException("登录已过期")
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

    private createRefreshToken(userId: string, rememberMe: boolean) {
        const token = randomBytes(48).toString("base64url");
        return {
            token,
            data: {
                userId,
                tokenHash: createHash("sha256").update(token).digest("hex"),
                rememberMe,
                expiresAt: new Date(Date.now() + refreshTokenTtlSeconds(rememberMe) * 1000)
            }
        }
    }

    async login(username: string, password: string, rememberMe = false) {
        const user = await this.db.user.findUnique({where: {username}});
        if (!user || !await verify(user.passwordHash, password)) throw new UnauthorizedException("用户名或密码错误");
        const access = await this.signAccessToken(user), refresh = this.createRefreshToken(user.id, rememberMe);
        await this.db.refreshToken.create({data: refresh.data});
        return {user: {id: user.id, username: user.username, role: user.role}, access, refresh: refresh.token, rememberMe}
    }

    async refresh(token?: string) {
        if (!token) throw new UnauthorizedException("登录状态已失效，请重新登录");
        const tokenHash = createHash("sha256").update(token).digest("hex"), now = new Date();
        const existing = await this.db.refreshToken.findUnique({where: {tokenHash}, include: {user: true}});
        if (!existing || existing.revokedAt || existing.expiresAt <= now || !existing.user) {
            throw new UnauthorizedException("登录状态已失效，请重新登录")
        }
        const next = this.createRefreshToken(existing.userId, existing.rememberMe);
        await this.db.$transaction(async transaction => {
            const revoked = await transaction.refreshToken.updateMany({
                where: {id: existing.id, revokedAt: null, expiresAt: {gt: now}}, data: {revokedAt: now}
            });
            if (revoked.count !== 1) throw new UnauthorizedException("登录状态已失效，请重新登录");
            await transaction.refreshToken.create({data: next.data})
        });
        return {
            user: {id: existing.user.id, username: existing.user.username, role: existing.user.role},
            access: await this.signAccessToken(existing.user), refresh: next.token, rememberMe: existing.rememberMe
        }
    }

    async logout(token?: string) {
        if (!token) return;
        const tokenHash = createHash("sha256").update(token).digest("hex");
        await this.db.refreshToken.updateMany({where: {tokenHash, revokedAt: null}, data: {revokedAt: new Date()}})
    }

    async current(token?: string) {
        if (!token) throw new UnauthorizedException();
        const {payload} = await jwtVerify(token, secret());
        return this.db.user.findUniqueOrThrow({
            where: {id: String(payload.sub)},
            select: {id: true, username: true, role: true}
        })
    }

    async changePassword(userId: string, currentPassword: string, newPassword: string) {
        if (typeof newPassword !== "string" || newPassword.length < 8 || newPassword.length > 128) {
            throw new BadRequestException("新密码长度必须为8至128个字符")
        }
        const user = await this.db.user.findUniqueOrThrow({where: {id: userId}});
        if (!await verify(user.passwordHash, currentPassword)) throw new UnauthorizedException("当前密码错误");
        if (await verify(user.passwordHash, newPassword)) throw new BadRequestException("新密码不能与当前密码相同");
        await this.db.$transaction([
            this.db.user.update({where: {id: userId}, data: {passwordHash: await hash(newPassword)}}),
            this.db.refreshToken.updateMany({where: {userId, revokedAt: null}, data: {revokedAt: new Date()}}),
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
        password: string,
        rememberMe?: boolean
    }, @Res({passthrough: true}) res: any) {
        const result = await this.auth.login(body.username, body.password, body.rememberMe === true);
        res.setCookie("access_token", result.access, cookieOptions("/", ACCESS_TOKEN_TTL_SECONDS));
        res.setCookie("refresh_token", result.refresh, cookieOptions("/api/auth", refreshTokenTtlSeconds(result.rememberMe)));
        return result.user
    }

    @Post("refresh") async refresh(@Req() req: any, @Res({passthrough: true}) res: any) {
        const result = await this.auth.refresh(req.cookies?.refresh_token);
        res.setCookie("access_token", result.access, cookieOptions("/", ACCESS_TOKEN_TTL_SECONDS));
        res.setCookie("refresh_token", result.refresh, cookieOptions("/api/auth", refreshTokenTtlSeconds(result.rememberMe)));
        return result.user
    }

    @Post("logout") async logout(@Req() req: any, @Res({passthrough: true}) res: any) {
        await this.auth.logout(req.cookies?.refresh_token);
        res.clearCookie("access_token", cookieOptions("/"));
        res.clearCookie("refresh_token", cookieOptions("/api/auth"));
        return {ok: true}
    }

    @Post("change-password") async changePassword(@Req() req: any, @Body() body: {
        currentPassword: string,
        newPassword: string
    }, @Res({passthrough: true}) res: any) {
        const result = await this.auth.changePassword(req.user.id, body.currentPassword, body.newPassword);
        res.clearCookie("access_token", cookieOptions("/"));
        res.clearCookie("refresh_token", cookieOptions("/api/auth"));
        return result
    }

    @Get("me") me(@Req() req: any) {
        return this.auth.current(req.cookies?.access_token)
    }
}
