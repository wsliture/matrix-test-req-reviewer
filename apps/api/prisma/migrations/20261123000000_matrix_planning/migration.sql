CREATE TYPE "ProjectSource" AS ENUM ('MANUAL', 'MATRIX');
ALTER TABLE "Project" ADD COLUMN "source" "ProjectSource" NOT NULL DEFAULT 'MANUAL';

CREATE TABLE "SystemSetting" (
    "key" TEXT PRIMARY KEY,
    "value" TEXT NOT NULL
);

CREATE TABLE "MatrixPlanningRun" (
    "toolId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "phase2RunId" TEXT NOT NULL UNIQUE,
    "externalProjectId" TEXT NOT NULL,
    "externalProjectName" TEXT NOT NULL,
    "projectVersion" TEXT NOT NULL,
    "langType" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "resultSummary" JSONB,
    "resultAttempts" INTEGER NOT NULL DEFAULT 0,
    "resultNextAt" TIMESTAMP(3),
    "resultReceipt" JSONB,
    "progressReceipt" JSONB,
    "progressKey" TEXT,
    "progressAttempts" INTEGER NOT NULL DEFAULT 0,
    "progressNextAt" TIMESTAMP(3),
    "cancelSettledAt" TIMESTAMP(3),
    PRIMARY KEY ("toolId", "runId")
);

CREATE INDEX "MatrixPlanningRun_projectId_idx" ON "MatrixPlanningRun" ("projectId");
