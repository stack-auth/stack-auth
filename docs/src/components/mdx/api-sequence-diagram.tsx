'use client';

import {
  Background,
  Edge,
  Handle,
  MarkerType,
  Node,
  NodeTypes,
  Position,
  ReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

// Actor node component - vertical lifelines with alternating sections
const ActorNode = ({ data }: { data: { label: string, sections: { highlighted: boolean, id: string }[] } }) => {
  return (
    <div className="flex flex-col items-center">
      {/* Actor header */}
      <div className="px-4 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white text-center font-medium text-sm mb-2">
        {data.label}
      </div>

      {/* Vertical lifeline with sections */}
      <div className="flex flex-col items-center">
        {data.sections.map((section) => (
          <div key={section.id} className="relative">
            {section.highlighted ? (
              // Highlighted section (box)
              <div className="w-12 h-16 bg-gray-800 border border-gray-600 rounded flex items-center justify-center">
                <Handle
                  type="target"
                  position={Position.Left}
                  id={`${section.id}-left`}
                  style={{ left: -8, background: 'transparent', border: 'none', width: 16, height: 16 }}
                />
                <Handle
                  type="source"
                  position={Position.Right}
                  id={`${section.id}-right`}
                  style={{ right: -8, background: 'transparent', border: 'none', width: 16, height: 16 }}
                />
              </div>
            ) : (
              // Regular line section
              <div className="w-0.5 h-16 bg-gray-400 flex items-center justify-center relative">
                <Handle
                  type="target"
                  position={Position.Left}
                  id={`${section.id}-left`}
                  style={{ left: -8, background: 'transparent', border: 'none', width: 16, height: 16 }}
                />
                <Handle
                  type="source"
                  position={Position.Right}
                  id={`${section.id}-right`}
                  style={{ right: -8, background: 'transparent', border: 'none', width: 16, height: 16 }}
                />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

// Action node component - text between actors
const ActionNode = ({ data }: { data: { label: string, dashed?: boolean } }) => {
  return (
    <div className={`px-3 py-1 bg-gray-800 border border-gray-600 rounded text-white text-sm font-medium whitespace-nowrap ${data.dashed ? 'border-dashed' : ''}`}>
      {data.label}
      <Handle type="target" position={Position.Left} style={{ background: 'transparent', border: 'none' }} />
      <Handle type="source" position={Position.Right} style={{ background: 'transparent', border: 'none' }} />
    </div>
  );
};

const nodeTypes: NodeTypes = {
  actor: ActorNode,
  action: ActionNode,
};

const initialNodes: Node[] = [
  // Actor nodes with their lifeline sections
  {
    id: 'user-actor',
    type: 'actor',
    position: { x: 50, y: 50 },
    data: {
      label: 'User/Client',
      sections: [
        { highlighted: true, id: 'user-1' },
        { highlighted: false, id: 'user-2' },
        { highlighted: false, id: 'user-3' },
        { highlighted: false, id: 'user-4' },
        { highlighted: true, id: 'user-5' },
      ]
    },
    draggable: false,
  },
  {
    id: 'server-actor',
    type: 'actor',
    position: { x: 300, y: 50 },
    data: {
      label: 'Your Application Server',
      sections: [
        { highlighted: true, id: 'server-1' },
        { highlighted: true, id: 'server-2' },
        { highlighted: true, id: 'server-3' },
        { highlighted: true, id: 'server-4' },
        { highlighted: true, id: 'server-5' },
      ]
    },
    draggable: false,
  },
  {
    id: 'auth-actor',
    type: 'actor',
    position: { x: 600, y: 50 },
    data: {
      label: 'Stack Auth Service',
      sections: [
        { highlighted: false, id: 'auth-1' },
        { highlighted: true, id: 'auth-2' },
        { highlighted: true, id: 'auth-3' },
        { highlighted: false, id: 'auth-4' },
        { highlighted: false, id: 'auth-5' },
      ]
    },
    draggable: false,
  },

  // Action nodes
  {
    id: 'action-1',
    type: 'action',
    position: { x: 175, y: 120 },
    data: { label: 'API request with API key' },
    draggable: false,
  },
  {
    id: 'action-2',
    type: 'action',
    position: { x: 450, y: 180 },
    data: { label: 'Validate API key' },
    draggable: false,
  },
  {
    id: 'action-3',
    type: 'action',
    position: { x: 450, y: 240 },
    data: { label: 'Return authenticated User object', dashed: true },
    draggable: false,
  },
  {
    id: 'action-4',
    type: 'action',
    position: { x: 300, y: 300 },
    data: { label: 'Process request' },
    draggable: false,
  },
  {
    id: 'action-5',
    type: 'action',
    position: { x: 175, y: 360 },
    data: { label: 'Response with data', dashed: true },
    draggable: false,
  },
];

const initialEdges: Edge[] = [
  // Step 1: API request
  {
    id: 'edge-1',
    source: 'user-actor',
    sourceHandle: 'user-1-right',
    target: 'action-1',
    style: { stroke: '#ffffff', strokeWidth: 2 },
    markerEnd: { type: MarkerType.ArrowClosed, color: '#ffffff' },
  },
  {
    id: 'edge-1b',
    source: 'action-1',
    target: 'server-actor',
    targetHandle: 'server-1-left',
    style: { stroke: '#ffffff', strokeWidth: 2 },
    markerEnd: { type: MarkerType.ArrowClosed, color: '#ffffff' },
  },

  // Step 2: Validate API key
  {
    id: 'edge-2',
    source: 'server-actor',
    sourceHandle: 'server-2-right',
    target: 'action-2',
    style: { stroke: '#ffffff', strokeWidth: 2 },
    markerEnd: { type: MarkerType.ArrowClosed, color: '#ffffff' },
  },
  {
    id: 'edge-2b',
    source: 'action-2',
    target: 'auth-actor',
    targetHandle: 'auth-2-left',
    style: { stroke: '#ffffff', strokeWidth: 2 },
    markerEnd: { type: MarkerType.ArrowClosed, color: '#ffffff' },
  },

  // Step 3: Return user object (dashed)
  {
    id: 'edge-3',
    source: 'auth-actor',
    sourceHandle: 'auth-3-left',
    target: 'action-3',
    style: { stroke: '#ffffff', strokeWidth: 2, strokeDasharray: '5,5' },
    markerEnd: { type: MarkerType.ArrowClosed, color: '#ffffff' },
  },
  {
    id: 'edge-3b',
    source: 'action-3',
    target: 'server-actor',
    targetHandle: 'server-3-right',
    style: { stroke: '#ffffff', strokeWidth: 2, strokeDasharray: '5,5' },
    markerEnd: { type: MarkerType.ArrowClosed, color: '#ffffff' },
  },

  // Step 4: Process request (self-loop)
  {
    id: 'edge-4',
    source: 'server-actor',
    sourceHandle: 'server-4-right',
    target: 'action-4',
    style: { stroke: '#ffffff', strokeWidth: 2 },
    markerEnd: { type: MarkerType.ArrowClosed, color: '#ffffff' },
  },
  {
    id: 'edge-4b',
    source: 'action-4',
    target: 'server-actor',
    targetHandle: 'server-4-left',
    style: { stroke: '#ffffff', strokeWidth: 2 },
    markerEnd: { type: MarkerType.ArrowClosed, color: '#ffffff' },
  },

  // Step 5: Response with data (dashed)
  {
    id: 'edge-5',
    source: 'server-actor',
    sourceHandle: 'server-5-left',
    target: 'action-5',
    style: { stroke: '#ffffff', strokeWidth: 2, strokeDasharray: '5,5' },
    markerEnd: { type: MarkerType.ArrowClosed, color: '#ffffff' },
  },
  {
    id: 'edge-5b',
    source: 'action-5',
    target: 'user-actor',
    targetHandle: 'user-5-right',
    style: { stroke: '#ffffff', strokeWidth: 2, strokeDasharray: '5,5' },
    markerEnd: { type: MarkerType.ArrowClosed, color: '#ffffff' },
  },
];

export default function ApiSequenceDiagram() {
  return (
    <div className="w-full h-[500px] bg-gray-900 rounded-lg border border-gray-700">
      <ReactFlow
        nodes={initialNodes}
        edges={initialEdges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 50 }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        panOnDrag={false}
        zoomOnScroll={false}
        zoomOnPinch={false}
        zoomOnDoubleClick={false}
        proOptions={{ hideAttribution: true }}
        className="bg-gray-900"
      >
        <Background color="#374151" gap={20} />
      </ReactFlow>
    </div>
  );
}
