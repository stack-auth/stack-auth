-- Drop workflow-related tables now that the workflows feature has been removed.
DROP TABLE IF EXISTS "WorkflowTrigger" CASCADE;
DROP TABLE IF EXISTS "WorkflowExecution" CASCADE;
DROP TABLE IF EXISTS "WorkflowTriggerToken" CASCADE;
DROP TABLE IF EXISTS "CurrentlyCompilingWorkflow" CASCADE;
DROP TABLE IF EXISTS "CompiledWorkflow" CASCADE;
