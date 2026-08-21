import {Module} from "@nestjs/common";
import {APP_GUARD} from "@nestjs/core";
import {PrismaService} from "./prisma.js";
import {AuthController, AuthGuard, AuthService} from "./auth.js";
import {ProjectsController, ProjectsService} from "./projects.js";
import {RunsController, RunsService} from "./runs.js";
import {ReviewsController} from "./reviews.js";
import {DocumentsController} from "./documents.js";
import {TraceabilityController, TraceabilityService} from "./traceability.js";
import {ExportsController} from "./exports.js";
import {SettingsController} from "./settings.js";

@Module({
    controllers: [AuthController, ProjectsController, RunsController, ReviewsController, DocumentsController, TraceabilityController, ExportsController, SettingsController],
    providers: [PrismaService, AuthService, ProjectsService, RunsService, TraceabilityService, {
        provide: APP_GUARD,
        useClass: AuthGuard
    }]
})
export class AppModule {
}
