import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Background,
    Controls,
    Panel,
    ReactFlow,
    ReactFlowProvider,
    applyEdgeChanges,
    applyNodeChanges,
    useReactFlow,
    type Connection,
    type EdgeChange,
    type NodeChange,
} from '@xyflow/react';
import type { DiagramState, ElementType } from '@kernel/contracts';
import '@xyflow/react/dist/style.css';
import './dfd-canvas.css';
import {
    ELEMENT_LABELS,
    connectionToEdge,
    fromFlow,
    newId,
    nextName,
    snapToGrid,
    toFlowEdge,
    toFlowNode,
    type DfdEdge,
    type DfdNode,
} from './convert';
import { NodeActionsContext, nodeTypes, type NodeActions } from './nodes';

/** How the plug-in pushes model changes it did not make itself (undo, load, ...) into the canvas. */
export interface ExternalSync {
    subscribe(listener: (state: DiagramState) => void): () => void;
}

export interface DfdCanvasProps {
    initialState: DiagramState;
    /** Called once per user gesture that changes the diagram, with the full new state. */
    onCommit(state: DiagramState): void;
    external: ExternalSync;
}

const DELETE_KEYS = ['Backspace', 'Delete'];
const ELEMENT_TYPES: ElementType[] = ['process', 'dataStore', 'externalEntity'];

function Canvas({ initialState, onCommit, external }: DfdCanvasProps) {
    const flow = useReactFlow<DfdNode, DfdEdge>();
    const wrapper = useRef<HTMLDivElement>(null);

    const [nodes, setNodesState] = useState<DfdNode[]>(() => initialState.elements.map(toFlowNode));
    const [edges, setEdgesState] = useState<DfdEdge[]>(() => initialState.dataFlows.map(toFlowEdge));

    // Refs hold the latest value so handlers can read it synchronously, before React re-renders.
    const nodesRef = useRef(nodes);
    const edgesRef = useRef(edges);
    // The canvas does not edit trust boundaries, but it must hand them back unchanged.
    const boundariesRef = useRef(initialState.trustBoundaries);

    const setNodes = useCallback((next: DfdNode[]) => {
        nodesRef.current = next;
        setNodesState(next);
    }, []);
    const setEdges = useCallback((next: DfdEdge[]) => {
        edgesRef.current = next;
        setEdgesState(next);
    }, []);

    // One user gesture can produce several React Flow callbacks (deleting a node reports the
    // node and each of its edges separately). Coalescing them into one commit means one store
    // update, so one undo step.
    const commitScheduled = useRef(false);
    const scheduleCommit = useCallback(() => {
        if (commitScheduled.current) return;
        commitScheduled.current = true;
        queueMicrotask(() => {
            commitScheduled.current = false;
            const state = fromFlow(nodesRef.current, edgesRef.current, boundariesRef.current);
            boundariesRef.current = state.trustBoundaries;
            onCommit(state);
        });
    }, [onCommit]);

    // Model changes made elsewhere (undo/redo, loading a project) replace the canvas contents
    // while keeping selection and measured sizes, so the view does not jump or flicker.
    useEffect(
        () =>
            external.subscribe((state) => {
                const oldNodes = new Map(nodesRef.current.map((n) => [n.id, n]));
                const oldEdges = new Map(edgesRef.current.map((e) => [e.id, e]));
                boundariesRef.current = state.trustBoundaries;
                setNodes(
                    state.elements.map((el) => {
                        const node = toFlowNode(el);
                        const old = oldNodes.get(el.id);
                        return old
                            ? { ...node, selected: old.selected, measured: old.measured, width: old.width, height: old.height }
                            : node;
                    }),
                );
                setEdges(
                    state.dataFlows.map((f) => {
                        const edge = toFlowEdge(f);
                        return { ...edge, selected: oldEdges.get(f.id)?.selected };
                    }),
                );
            }),
        [external, setNodes, setEdges],
    );

    const onNodesChange = useCallback(
        (changes: NodeChange<DfdNode>[]) => {
            setNodes(applyNodeChanges(changes, nodesRef.current));
            // Positions stream in while dragging; only the end of a move (or a keyboard nudge,
            // which also reports `dragging: false`) or a removal is a real edit.
            if (changes.some((c) => c.type === 'remove' || (c.type === 'position' && !c.dragging))) {
                scheduleCommit();
            }
        },
        [setNodes, scheduleCommit],
    );

    const onEdgesChange = useCallback(
        (changes: EdgeChange<DfdEdge>[]) => {
            setEdges(applyEdgeChanges(changes, edgesRef.current));
            if (changes.some((c) => c.type === 'remove')) scheduleCommit();
        },
        [setEdges, scheduleCommit],
    );

    const onConnect = useCallback(
        (connection: Connection) => {
            const edge = connectionToEdge(connection, edgesRef.current, newId('flow'));
            if (!edge) return;
            setEdges([...edgesRef.current, edge]);
            scheduleCommit();
        },
        [setEdges, scheduleCommit],
    );

    const addNode = useCallback(
        (type: ElementType) => {
            const rect = wrapper.current?.getBoundingClientRect();
            const centre = flow.screenToFlowPosition({
                x: (rect?.left ?? 0) + (rect?.width ?? 0) / 2,
                y: (rect?.top ?? 0) + (rect?.height ?? 0) / 2,
            });
            // Stagger new nodes so repeated clicks do not stack them exactly on top of each other.
            const stagger = (nodesRef.current.length % 6) * 20;
            const node: DfdNode = {
                id: newId('el'),
                type,
                position: { x: snapToGrid(centre.x - 60 + stagger), y: snapToGrid(centre.y - 40 + stagger) },
                data: {
                    name: nextName(
                        ELEMENT_LABELS[type],
                        nodesRef.current.map((n) => n.data.name),
                    ),
                    properties: {},
                },
            };
            setNodes([...nodesRef.current, node]);
            scheduleCommit();
        },
        [flow, setNodes, scheduleCommit],
    );

    const deleteSelected = useCallback(() => {
        void flow.deleteElements({
            nodes: nodesRef.current.filter((n) => n.selected),
            edges: edgesRef.current.filter((e) => e.selected),
        });
    }, [flow]);

    const rename = useCallback<NodeActions['rename']>(
        (id, name) => {
            setNodes(nodesRef.current.map((n) => (n.id === id ? { ...n, data: { ...n.data, name } } : n)));
            scheduleCommit();
        },
        [setNodes, scheduleCommit],
    );
    const actions = useMemo<NodeActions>(() => ({ rename }), [rename]);

    return (
        <div ref={wrapper} style={{ width: '100%', height: '100%' }}>
            <NodeActionsContext.Provider value={actions}>
                <ReactFlow
                    nodes={nodes}
                    edges={edges}
                    nodeTypes={nodeTypes}
                    onNodesChange={onNodesChange}
                    onEdgesChange={onEdgesChange}
                    onConnect={onConnect}
                    onNodeDragStop={scheduleCommit}
                    isValidConnection={(c) => c.source !== c.target}
                    deleteKeyCode={DELETE_KEYS}
                    snapToGrid
                    snapGrid={[10, 10]}
                    minZoom={0.2}
                    maxZoom={2}
                    fitView
                >
                    <Background />
                    <Controls showInteractive={false} />
                    <Panel position="top-left">
                        <div className="dfd-toolbar" role="toolbar" aria-label="Diagram tools">
                            {ELEMENT_TYPES.map((type) => (
                                <button key={type} type="button" onClick={() => addNode(type)}>
                                    Add {ELEMENT_LABELS[type].toLowerCase()}
                                </button>
                            ))}
                            <button type="button" onClick={deleteSelected}>
                                Delete selected
                            </button>
                        </div>
                    </Panel>
                </ReactFlow>
            </NodeActionsContext.Provider>
        </div>
    );
}

export function DfdCanvas(props: DfdCanvasProps) {
    return (
        <ReactFlowProvider>
            <Canvas {...props} />
        </ReactFlowProvider>
    );
}