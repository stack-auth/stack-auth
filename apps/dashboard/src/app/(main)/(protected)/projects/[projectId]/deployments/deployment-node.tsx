"use client";

import { DesignButton, DesignInput } from "@/components/design-components";
import { cn } from "@/lib/utils";
import {
  CloudArrowUpIcon,
  CpuIcon,
  DatabaseIcon,
  GlobeHemisphereWestIcon,
  HardDrivesIcon,
  HexagonIcon,
  LightningIcon,
  PlusIcon,
  StackIcon,
  TrashIcon,
  type Icon as PhosphorIcon,
} from "@phosphor-icons/react";
import {
  Handle,
  Position,
  type NodeProps,
  useReactFlow,
  useStore,
} from "@xyflow/react";
import { useMemo } from "react";
import type {
  DeploymentEdge,
  DeploymentField,
  DeploymentNode,
  ServiceKind,
} from "./deployment-model";

const SERVICE_ICONS = new Map<ServiceKind, PhosphorIcon>([
  ["serverless", CloudArrowUpIcon],
  ["server", HardDrivesIcon],
  ["postgres", DatabaseIcon],
  ["convex", LightningIcon],
  ["redis", StackIcon],
  ["worker", CpuIcon],
  ["public-internet", GlobeHemisphereWestIcon],
  ["hexclave", HexagonIcon],
]);

const SERVICE_ACCENTS = new Map<ServiceKind, string>([
  ["serverless", "bg-blue-500/10 text-blue-600 dark:text-blue-400"],
  ["server", "bg-slate-500/10 text-slate-600 dark:text-slate-300"],
  ["postgres", "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400"],
  ["convex", "bg-orange-500/10 text-orange-600 dark:text-orange-400"],
  ["redis", "bg-red-500/10 text-red-600 dark:text-red-400"],
  ["worker", "bg-purple-500/10 text-purple-600 dark:text-purple-400"],
  ["public-internet", "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"],
  ["hexclave", "bg-purple-500/10 text-purple-600 dark:text-purple-400"],
]);

function mapValueOrThrow<TKey, TValue>(map: Map<TKey, TValue>, key: TKey, name: string): TValue {
  const value = map.get(key);
  if (value == null) {
    throw new Error(`Missing ${name} for deployment service kind "${String(key)}".`);
  }
  return value;
}

function FieldHandle(props: {
  field: DeploymentField,
  direction: "input" | "output",
  connected: boolean,
  keepValueWhenConnected?: boolean,
  onLabelChange?: (label: string) => void,
  onValueChange?: (value: string) => void,
}) {
  const isInput = props.direction === "input";

  return (
    <div className="relative px-3 py-2.5">
      <Handle
        id={props.field.id}
        type={isInput ? "target" : "source"}
        position={isInput ? Position.Left : Position.Right}
        className={cn(
          "!h-3 !w-3 !border-2 !border-background !shadow-sm",
          props.connected ? "!bg-blue-500" : "!bg-muted-foreground",
        )}
      />
      <div className="mb-1 flex items-center justify-between gap-3">
        {props.onLabelChange ? (
          <DesignInput
            aria-label="Environment variable key"
            className="nodrag nowheel min-w-0 flex-1 font-mono"
            onChange={(event) => props.onLabelChange?.(event.target.value)}
            size="sm"
            value={props.field.label}
          />
        ) : (
          <span className="truncate text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {props.field.label}
          </span>
        )}
        {props.connected && (
          <span className="text-[10px] font-medium text-blue-600 dark:text-blue-400">
            Connected
          </span>
        )}
      </div>
      {isInput && props.onValueChange ? (
        <DesignInput
          aria-label={`${props.field.label} value`}
          className="nodrag nowheel"
          disabled={props.connected}
          onChange={(event) => props.onValueChange?.(event.target.value)}
          placeholder={props.connected ? "Value supplied by connection" : "Enter a value"}
          size="sm"
          value={props.connected && !props.keepValueWhenConnected ? "" : props.field.value}
        />
      ) : (
        <div
          className="truncate rounded-lg bg-foreground/[0.035] px-2.5 py-1.5 font-mono text-[11px] text-foreground"
          title={props.field.secret ? "Secret value hidden" : props.field.value}
        >
          {props.field.value || "Available after deploy"}
        </div>
      )}
    </div>
  );
}

export function DeploymentNodeCard({
  id,
  data,
  selected,
}: NodeProps<DeploymentNode>) {
  const edges = useStore((state) => state.edges);
  const { deleteElements, updateNodeData } = useReactFlow<DeploymentNode, DeploymentEdge>();
  const Icon = mapValueOrThrow(SERVICE_ICONS, data.kind, "service icon");
  const accent = mapValueOrThrow(SERVICE_ACCENTS, data.kind, "service accent");

  const connectedInputHandles = useMemo(() => new Set(
    edges
      .filter((edge) => edge.target === id && edge.targetHandle != null)
      .map((edge) => edge.targetHandle)
      .filter((handle) => handle != null),
  ), [edges, id]);

  const connectedOutputHandles = useMemo(() => new Set(
    edges
      .filter((edge) => edge.source === id && edge.sourceHandle != null)
      .map((edge) => edge.sourceHandle)
      .filter((handle) => handle != null),
  ), [edges, id]);

  function updateInput(fieldId: string, value: string) {
    updateNodeData(id, {
      inputs: data.inputs.map((input) => input.id === fieldId ? { ...input, value } : input),
    });
  }

  function updateInputLabel(fieldId: string, label: string) {
    updateNodeData(id, {
      inputs: data.inputs.map((input) => input.id === fieldId ? { ...input, label } : input),
    });
  }

  function addInput() {
    const isDomain = data.kind === "public-internet";
    updateNodeData(id, {
      inputs: [
        ...data.inputs,
        {
          id: `${id}-${crypto.randomUUID()}`,
          label: isDomain ? "Domain" : "NEW_ENV_VAR",
          value: isDomain ? "new.example.com" : "",
        },
      ],
    });
  }

  return (
    <div
      className={cn(
        "w-[320px] overflow-hidden rounded-2xl border bg-background/95 shadow-lg backdrop-blur-xl",
        "transition-[border-color,box-shadow] duration-150 hover:transition-none",
        selected
          ? "border-blue-500/70 shadow-blue-500/10 ring-2 ring-blue-500/15"
          : "border-border/80 hover:border-foreground/20",
      )}
    >
      <div className="flex items-center gap-3 border-b border-border/70 p-3">
        <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", accent)}>
          <Icon size={19} weight="duotone" />
        </div>
        <div className="min-w-0 flex-1">
          {data.immutable ? (
            <>
              <div className="truncate text-sm font-semibold text-foreground">{data.title}</div>
              <div className="text-[11px] text-muted-foreground">Managed by Hexclave</div>
            </>
          ) : (
            <DesignInput
              aria-label="Service name"
              className="nodrag nowheel"
              onChange={(event) => updateNodeData(id, { title: event.target.value })}
              size="sm"
              value={data.title}
            />
          )}
        </div>
        {!data.immutable && (
          <DesignButton
            aria-label={`Delete ${data.title}`}
            className="nodrag h-8 w-8 shrink-0 p-0 text-muted-foreground"
            onClick={async () => {
              await deleteElements({ nodes: [{ id }] });
            }}
            size="icon"
            variant="ghost"
          >
            <TrashIcon size={16} />
          </DesignButton>
        )}
      </div>

      {data.inputs.length > 0 && (
        <div className="divide-y divide-border/60">
          {data.inputs.map((input) => (
            <FieldHandle
              key={input.id}
              connected={connectedInputHandles.has(input.id)}
              direction="input"
              field={input}
              keepValueWhenConnected={data.kind === "public-internet"}
              onLabelChange={data.kind === "public-internet" ? undefined : (label) => updateInputLabel(input.id, label)}
              onValueChange={(value) => updateInput(input.id, value)}
            />
          ))}
        </div>
      )}

      {data.outputs.length > 0 && (
        <div className="divide-y divide-border/60 border-t border-border/70 bg-foreground/[0.018]">
          {data.outputs.map((output) => (
            <FieldHandle
              key={output.id}
              connected={connectedOutputHandles.has(output.id)}
              direction="output"
              field={output}
            />
          ))}
        </div>
      )}

      {data.kind !== "hexclave" && (
        <div className="border-t border-border/70 p-2">
          <DesignButton
            className="nodrag w-full justify-center gap-1.5 text-xs"
            onClick={addInput}
            size="sm"
            variant="ghost"
          >
            <PlusIcon size={13} />
            {data.kind === "public-internet" ? "Add domain" : "Add environment variable"}
          </DesignButton>
        </div>
      )}
    </div>
  );
}
