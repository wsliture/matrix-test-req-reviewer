ALTER TABLE "Phase2Run" ADD COLUMN "createdAt" TIMESTAMP(3);
UPDATE "Phase2Run" AS r
SET "createdAt" = COALESCE(
    (SELECT e."createdAt" FROM "RunEvent" e WHERE e."runId" = r.id ORDER BY e.id LIMIT 1),
    r."startedAt", r."finishedAt", p."createdAt"
)
FROM "Project" p WHERE p.id = r."projectId";
ALTER TABLE "Phase2Run" ALTER COLUMN "createdAt" SET DEFAULT CURRENT_TIMESTAMP,
                       ALTER COLUMN "createdAt" SET NOT NULL;
ALTER TABLE "MatrixPlanningRun" ADD COLUMN "inputFingerprint" TEXT;
CREATE INDEX "MatrixPlanningRun_toolId_externalProjectId_idx" ON "MatrixPlanningRun" ("toolId", "externalProjectId");
