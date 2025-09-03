-- CreateTable
CREATE TABLE "WorkflowTriggerToken" (
    "tenancyId" UUID NOT NULL,
    "id" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkflowTriggerToken_pkey" PRIMARY KEY ("tenancyId","id")
);

-- CreateTable
CREATE TABLE "WorkflowTrigger" (
    "tenancyId" UUID NOT NULL,
    "id" UUID NOT NULL,
    "executionId" UUID NOT NULL,
    "triggerData" JSONB NOT NULL,
    "scheduledAt" TIMESTAMP(3),
    "output" JSONB,
    "error" JSONB,
    "compiledWorkflowId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkflowTrigger_pkey" PRIMARY KEY ("tenancyId","id")
);

-- CreateTable
CREATE TABLE "WorkflowExecution" (
    "tenancyId" UUID NOT NULL,
    "id" UUID NOT NULL,
    "workflowId" TEXT NOT NULL,
    "triggerIds" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkflowExecution_pkey" PRIMARY KEY ("tenancyId","id")
);

-- CreateTable
CREATE TABLE "CurrentlyCompilingWorkflow" (
    "tenancyId" UUID NOT NULL,
    "workflowId" TEXT NOT NULL,
    "compilationVersion" INTEGER NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "startedCompilingAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CurrentlyCompilingWorkflow_pkey" PRIMARY KEY ("tenancyId","workflowId","compilationVersion","sourceHash")
);

-- CreateTable
CREATE TABLE "CompiledWorkflow" (
    "tenancyId" UUID NOT NULL,
    "id" UUID NOT NULL,
    "workflowId" TEXT NOT NULL,
    "compilationVersion" INTEGER NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "compiledCode" TEXT,
    "compileError" TEXT,
    "compiledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "registeredTriggers" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompiledWorkflow_pkey" PRIMARY KEY ("tenancyId","id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowTriggerToken_tenancyId_tokenHash_key" ON "WorkflowTriggerToken"("tenancyId", "tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "CompiledWorkflow_tenancyId_workflowId_compilationVersion_so_key" ON "CompiledWorkflow"("tenancyId", "workflowId", "compilationVersion", "sourceHash");

-- AddForeignKey
ALTER TABLE "WorkflowTrigger" ADD CONSTRAINT "WorkflowTrigger_tenancyId_compiledWorkflowId_fkey" FOREIGN KEY ("tenancyId", "compiledWorkflowId") REFERENCES "CompiledWorkflow"("tenancyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowTrigger" ADD CONSTRAINT "WorkflowTrigger_tenancyId_executionId_fkey" FOREIGN KEY ("tenancyId", "executionId") REFERENCES "WorkflowExecution"("tenancyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
