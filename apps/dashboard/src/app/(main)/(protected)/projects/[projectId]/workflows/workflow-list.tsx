import { useRouter } from "@/components/router";
import { cn } from "@/lib/utils";
import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@stackframe/stack-ui";
import { MoreVertical } from "lucide-react";
import { useState } from "react";
import { ListSection } from "../payments/offers/list-section";

type Workflow = {
  id: string,
  displayName: string,
  tsSource: string,
  enabled: boolean,
};

type WorkflowListItemProps = {
  workflow: Workflow,
  projectId: string,
  onEdit?: () => void,
  onDelete?: () => void,
  onDuplicate?: () => void,
  onToggleEnabled?: () => void,
};

function WorkflowListItem({
  workflow,
  projectId,
  onEdit,
  onDelete,
  onDuplicate,
  onToggleEnabled,
}: WorkflowListItemProps) {
  const router = useRouter();
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const handleClick = () => {
    router.push(`/projects/${projectId}/workflows/${workflow.id}`);
  };

  return (
    <div
      className={cn(
        "px-3 py-3 cursor-pointer relative duration-200 hover:duration-0 hover:bg-primary/10 transition-colors flex items-center justify-between group"
      )}
      onClick={handleClick}
    >
      <div className="flex-1">
        <div className="flex items-center gap-2 mb-1">
          <span className="font-medium text-sm">{workflow.displayName}</span>
          <span
            className={cn(
              "px-2 py-0.5 text-xs rounded-full border",
              workflow.enabled
                ? "bg-green-500/10 text-green-600 border-green-500/20"
                : "bg-gray-500/10 text-gray-600 border-gray-500/20"
            )}
          >
            {workflow.enabled ? "Enabled" : "Disabled"}
          </span>
        </div>
        <div className="text-xs text-muted-foreground font-mono mb-1">
          {workflow.id}
        </div>
        <div className="text-xs text-muted-foreground">
          {workflow.tsSource ? `${workflow.tsSource.split('\n').length} lines of code` : "No source code"}
        </div>
      </div>
      <div
        onClick={(e) => e.stopPropagation()}
        onMouseEnter={() => setIsMenuOpen(true)}
        onMouseLeave={() => setIsMenuOpen(false)}
      >
        <DropdownMenu open={isMenuOpen} onOpenChange={setIsMenuOpen}>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              className={cn(
                "h-8 w-8 p-0 relative",
                "hover:bg-secondary/80",
                isMenuOpen && "bg-secondary/80"
              )}
            >
              <MoreVertical className="h-4 w-4" />
              <span className="sr-only">Open menu</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[150px]">
            <DropdownMenuItem onClick={onToggleEnabled}>
              {workflow.enabled ? "Disable" : "Enable"}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onEdit}>Edit</DropdownMenuItem>
            <DropdownMenuItem onClick={onDuplicate}>Duplicate</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={onDelete}
              className="text-destructive focus:text-destructive"
            >
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}


export function WorkflowList({
  workflows,
  projectId,
  onAddClick,
  onEdit,
  onDelete,
  onDuplicate,
  onToggleEnabled
}: {
  workflows: Workflow[],
  projectId: string,
  onAddClick?: () => void,
  onEdit?: (workflow: Workflow) => void,
  onDelete?: (workflowId: string) => void,
  onDuplicate?: (workflow: Workflow) => void,
  onToggleEnabled?: (workflow: Workflow) => void,
}) {
  const [searchQuery, setSearchQuery] = useState("");

  const filteredWorkflows = workflows.filter((workflow) => {
    const query = searchQuery.toLowerCase();
    return (
      workflow.id.toLowerCase().includes(query) ||
      workflow.displayName.toLowerCase().includes(query) ||
      (workflow.tsSource && workflow.tsSource.toLowerCase().includes(query))
    );
  });

  return (
    <ListSection
      title="Workflows"
      titleTooltip="Workflows automate complex business processes and integrations"
      onAddClick={onAddClick}
      searchValue={searchQuery}
      onSearchChange={setSearchQuery}
      searchPlaceholder="Search workflows..."
    >
      <div>
        {filteredWorkflows.map((workflow) => (
          <WorkflowListItem
            key={workflow.id}
            workflow={workflow}
            projectId={projectId}
            onEdit={() => onEdit?.(workflow)}
            onDelete={() => onDelete?.(workflow.id)}
            onDuplicate={() => onDuplicate?.(workflow)}
            onToggleEnabled={() => onToggleEnabled?.(workflow)}
          />
        ))}
      </div>
    </ListSection>
  );
}
