import { createContext, useContext, useRef, useState } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { DfdNode } from './convert';

/** Lets a node ask the canvas to rename it without the node knowing how state is stored. */
export interface NodeActions {
    rename(id: string, name: string): void;
}

export const NodeActionsContext = createContext<NodeActions>({ rename: () => {} });

/** Double-click to rename. Enter or blur saves, Escape cancels, blank names are ignored. */
function NodeLabel({ id, name }: { id: string; name: string }) {
    const { rename } = useContext(NodeActionsContext);
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(name);
    const cancelled = useRef(false);

    const finish = () => {
        setEditing(false);
        const next = draft.trim();
        if (!cancelled.current && next !== '' && next !== name) rename(id, next);
    };

    if (editing) {
        return (
            <input
                className="nodrag dfd-node__input"
                aria-label="Element name"
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={finish}
                onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur();
                    if (e.key === 'Escape') {
                        cancelled.current = true;
                        e.currentTarget.blur();
                    }
                }}
            />
        );
    }

    return (
        <span
            className="dfd-node__label"
            onDoubleClick={() => {
                cancelled.current = false;
                setDraft(name);
                setEditing(true);
            }}
        >
            {name}
        </span>
    );
}

/** One component for all three element types; the shape comes from the CSS modifier class. */
function ElementNode({ id, type, data, selected }: NodeProps<DfdNode>) {
    return (
        <div className={`dfd-node dfd-node--${type}`} data-selected={selected ? 'true' : 'false'}>
            <Handle type="target" position={Position.Left} />
            <NodeLabel id={id} name={data.name} />
            <Handle type="source" position={Position.Right} />
        </div>
    );
}

/** Keys match the model's ElementType, so `node.type` needs no mapping. */
export const nodeTypes = {
    process: ElementNode,
    dataStore: ElementNode,
    externalEntity: ElementNode,
};