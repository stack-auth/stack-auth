CREATE TABLE "LocalEmulatorProject" (
  "absoluteFilePath" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "LocalEmulatorProject_pkey" PRIMARY KEY ("absoluteFilePath")
);

CREATE UNIQUE INDEX "LocalEmulatorProject_projectId_key" ON "LocalEmulatorProject"("projectId");

ALTER TABLE "LocalEmulatorProject"
ADD CONSTRAINT "LocalEmulatorProject_projectId_fkey"
FOREIGN KEY ("projectId")
REFERENCES "Project"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;
