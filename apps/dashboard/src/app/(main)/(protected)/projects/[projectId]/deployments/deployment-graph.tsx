"use client";

import { DesignButton, DesignMenu } from "@/components/design-components";
import {
  ArrowCounterClockwiseIcon,
  ArrowsOutIcon,
  CloudArrowUpIcon,
  CpuIcon,
  DatabaseIcon,
  HardDrivesIcon,
  LightningIcon,
  PlusIcon,
  StackIcon,
} from "@phosphor-icons/react";
import {
  addEdge,
  Background,
  BackgroundVariant,
  MiniMap,
  Panel,
  ReactFlow,
  type Connection,
  type NodeTypes,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useState } from "react";
import {
  ADDABLE_SERVICE_KINDS,
  createInitialDeploymentGraph,
  createServiceNode,
  type DeploymentEdge,
  type DeploymentNode,
  type ServiceKind,
} from "./deployment-model";
import { DeploymentNodeCard } from "./deployment-node";

const NODE_TYPES = {
  deployment: DeploymentNodeCard,
} satisfies NodeTypes;

const SERVICE_MENU_ITEMS = [
  { kind: "serverless", label: "Serverless", icon: <CloudArrowUpIcon size={16} /> },
  { kind: "server", label: "Server", icon: <HardDrivesIcon size={16} /> },
  { kind: "postgres", label: "Postgres", icon: <DatabaseIcon size={16} /> },
  { kind: "convex", label: "Convex", icon: <LightningIcon size={16} /> },
  { kind: "redis", label: "Redis", icon: <StackIcon size={16} /> },
  { kind: "worker", label: "Worker", icon: <CpuIcon size={16} /> },
] satisfies readonly {
  kind: typeof ADDABLE_SERVICE_KINDS[number],
  label: string,
  icon: React.ReactNode,
}[];

function GraphControls(props: {
  onReset: () => void,
}) {
  const { fitView } = useReactFlow<DeploymentNode, DeploymentEdge>();

  return (
    <Panel className="flex gap-2" position="top-right">
      <DesignButton
        className="gap-1.5 bg-background/90 shadow-sm backdrop-blur-xl"
        onClick={async () => {
          await fitView({ duration: 200, padding: 0.2 });
        }}
        size="sm"
        variant="outline"
      >
        <ArrowsOutIcon size={15} />
        Fit view
      </DesignButton>
      <DesignButton
        className="gap-1.5 bg-background/90 shadow-sm backdrop-blur-xl"
        onClick={props.onReset}
        size="sm"
        variant="outline"
      >
        <ArrowCounterClockwiseIcon size={15} />
        Reset
      </DesignButton>
    </Panel>
  );
}

function miniMapColor(node: DeploymentNode): string {
  const colors = new Map<ServiceKind, string>([
    ["serverless", "#3b82f6"],
    ["server", "#64748b"],
    ["postgres", "#06b6d4"],
    ["convex", "#f97316"],
    ["redis", "#ef4444"],
    ["worker", "#a855f7"],
    ["public-internet", "#10b981"],
    ["hexclave", "#8b5cf6"],
  ]);
  const color = colors.get(node.data.kind);
  if (color == null) {
    throw new Error(`Missing minimap color for deployment service kind "${node.data.kind}".`);
  }
  return color;
}

export function DeploymentGraph({ projectId }: { projectId: string }) {
  const [initialGraph] = useState(() => createInitialDeploymentGraph(projectId));
  const [nodes, setNodes, onNodesChange] = useNodesState<DeploymentNode>(initialGraph.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<DeploymentEdge>(initialGraph.edges);

  function addService(kind: ServiceKind) {
    setNodes((currentNodes) => [
      ...currentNodes,
      createServiceNode(kind, currentNodes.filter((node) => !node.data.immutable).length),
    ]);
  }

  function connect(connection: Connection) {
    if (connection.sourceHandle == null || connection.targetHandle == null) {
      throw new Error("Deployment connections must join a specific output to a specific input.");
    }

    setEdges((currentEdges) => addEdge(
      {
        ...connection,
        id: crypto.randomUUID(),
        type: "smoothstep",
        animated: true,
      },
      currentEdges.filter((edge) => (
        edge.target !== connection.target
        || edge.targetHandle !== connection.targetHandle
      )),
    ));
  }

  function resetGraph() {
    const reset = createInitialDeploymentGraph(projectId);
    setNodes(reset.nodes);
    setEdges(reset.edges);
  }

  return (
    <div className="relative min-h-[560px] flex-1 overflow-hidden rounded-2xl border border-border/70 bg-background shadow-sm">
      <ReactFlow<DeploymentNode, DeploymentEdge>
        connectionLineStyle={{ stroke: "hsl(var(--primary))", strokeWidth: 2 }}
        defaultEdgeOptions={{
          style: { stroke: "hsl(var(--muted-foreground))", strokeWidth: 1.5 },
        }}
        deleteKeyCode={["Backspace", "Delete"]}
        edges={edges}
        fitView
        fitViewOptions={{ maxZoom: 1, padding: 0.2 }}
        isValidConnection={(connection) => (
          connection.source !== connection.target
          && connection.sourceHandle != null
          && connection.targetHandle != null
        )}
        maxZoom={1.6}
        minZoom={0.2}
        nodeTypes={NODE_TYPES}
        nodes={nodes}
        onConnect={connect}
        onEdgesChange={onEdgesChange}
        onNodesChange={onNodesChange}
        panOnScroll
        proOptions={{ hideAttribution: true }}
        selectionOnDrag
        snapGrid={[16, 16]}
        snapToGrid
      >
        <Background
          color="hsl(var(--muted-foreground))"
          gap={24}
          size={1}
          variant={BackgroundVariant.Dots}
        />
        <Panel position="top-left">
          <DesignMenu
            align="start"
            contentClassName="w-56"
            items={SERVICE_MENU_ITEMS.map((service) => ({
              id: service.kind,
              label: service.label,
              icon: service.icon,
              onClick: () => addService(service.kind),
            }))}
            label="Service type"
            triggerLabel="Add service"
            triggerIcon={<PlusIcon size={15} />}
            variant="actions"
            withIcons
          />
        </Panel>
        <GraphControls onReset={resetGraph} />
        <Panel
          className="rounded-xl border border-border/70 bg-background/90 px-3 py-2 text-[11px] text-muted-foreground shadow-sm backdrop-blur-xl"
          position="bottom-left"
        >
          Drag nodes to arrange · Drag between ports to connect · Select and press Delete
        </Panel>
        <MiniMap
          className="!rounded-xl !border !border-border/70 !bg-background/90 !shadow-sm"
          maskColor="hsl(var(--background) / 0.65)"
          nodeColor={miniMapColor}
          pannable
          zoomable
        />
      </ReactFlow>
    </div>
  );
}
