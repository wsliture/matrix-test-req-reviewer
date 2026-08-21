import {
    Body,
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
import {verify} from "argon2";
import {jwtVerify, SignJWT} from "jose";
import {createHash, randomBytes} from "node:crypto";

const secret = () => new TextEncoder().encode(process.env.JWT_SECRET || "development-secret-change-me-now");

@Injectable()
export class AuthGuard implements CanActivate {
    async canActivate(context: ExecutionContext) {
        const request = context.switchToHttp().getRequest();
        if (request.url?.includes("/auth/login") || request.url?.includes("/auth/logout")) return true;
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

    async login(username: string, password: string) {
        const user = await this.db.user.findUnique({where: {username}});
        if (!user || !await verify(user.passwordHash, password)) throw new UnauthorizedException("用户名或密码错误");
        const access = await new SignJWT({role: user.role}).setProtectedHeader({alg: "HS256"}).setSubject(user.id).setExpirationTime("15m").sign(secret());
        const refresh = randomBytes(48).toString("base64url"),
            tokenHash = createHash("sha256").update(refresh).digest("hex");
        await this.db.refreshToken.create({
            data: {
                userId: user.id,
                tokenHash,
                expiresAt: new Date(Date.now() + 30 * 86400000)
            }
        });
        return {user: {id: user.id, username: user.username, role: user.role}, access, refresh}
    }

    async current(token?: string) {
        if (!token) throw new UnauthorizedException();
        const {payload} = await jwtVerify(token, secret());
        return this.db.user.findUniqueOrThrow({
            where: {id: String(payload.sub)},
            select: {id: true, username: true, role: true}
        })
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
        res.setCookie("access_token", result.access, {
            httpOnly: true,
            sameSite: "strict",
            secure: process.env.NODE_ENV === "production",
            path: "/"
        });
        res.setCookie("refresh_token", result.refresh, {
            httpOnly: true,
            sameSite: "strict",
            secure: process.env.NODE_ENV === "production",
            path: "/api/auth"
        });
        return result.user
    }

    @Post("logout") logout(@Res({passthrough: true}) res: any) {
        res.clearCookie("access_token", {path: "/"});
        res.clearCookie("refresh_token", {path: "/api/auth"});
        return {ok: true}
    }

    @Get("me") me(@Req() req: any) {
        return this.auth.current(req.cookies?.access_token)
    }
}
