import {Body, Controller, Get, Param, Post, Req} from "@nestjs/common";
import {PrismaService} from "./prisma.js";

@Controller("projects/:projectId/reviews")
export class ReviewsController {
    constructor(private db: PrismaService) {
    }

    @Get() list(@Param("projectId") projectId: string) {
        return this.db.review.findMany({where: {projectId}, orderBy: {createdAt: "desc"}})
    }

    @Post() async save(@Param("projectId") projectId: string, @Req() req: any, @Body() body: {
        nodeId: string;
        scores: { correctness: number; completeness: number; coverage: number; testability: number };
        issues?: string[];
        comment?: string
    }) {
        const reviewerId = req.user.id,
            weighted = body.scores.correctness * .35 + body.scores.completeness * .25 + body.scores.coverage * .2 + body.scores.testability * .2,
            grade = weighted >= 4.5 ? "优秀" : weighted >= 3.5 ? "良好" : weighted >= 2.5 ? "合格" : "不合格",
            latest = await this.db.review.findFirst({
                where: {projectId, nodeId: body.nodeId},
                orderBy: {version: "desc"}
            });
        return this.db.review.create({
            data: {
                projectId,
                reviewerId,
                nodeId: body.nodeId,
                version: (latest?.version || 0) + 1,
                scores: body.scores,
                weightedScore: weighted,
                grade,
                issues: body.issues || [],
                comment: body.comment
            }
        })
    }
}
