import { useCallback, useRef, useState } from 'react';
import type { BlockTypeMeta, Pipeline, PipelineEdge, PipelineNode } from '../../lib/api';
import type { TypeIndex } from './studioState';
import { Wires } from './Wires';

interface CanvasProps {
  pipeline: Pipeline;
  typeIndex: TypeIndex;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onMove: (id: string, pos: { x: number; y: number }) => void;
  onDelete: (id: string) => void;
  onConnect: (fromNode: string, toNode: string, toPort: string) => void;
  onDeleteEdge: (edge: PipelineEdge) => void;
  onAddAt: (type: string, pos: { x: number; y: number }) => void;
  setStatus: (message: string, kind?: '' | 'ok' | 'error') => void;
}

const FALLBACK_POS = { x: 40, y: 40 };

interface DragState {
  id: string;
  /** pointer→node offset captured on grab. */
  dx: number;
  dy: number;
}

/** Compact model suffix shown on the node id row (deepseek-v4-flash → flash). */
function modelSuffix(model?: string): string {
  if (!model) {
    return '';
  }
  return ` ·${model.replace('deepseek-v4-', '')}`;
}

/**
 * Center pane (`.ps-canvas`): absolutely-positioned `.ps-node` cards + the SVG
 * wire layer. Nodes drag via pointer events (left/top, no layout animation),
 * ports connect by click-output→click-input (type-checked upstream), and the
 * palette can be dropped here to add a node at the cursor. Maps to `#ps-canvas`.
 */
export function Canvas({
  pipeline,
  typeIndex,
  selectedId,
  onSelect,
  onMove,
  onDelete,
  onConnect,
  onDeleteEdge,
  onAddAt,
  setStatus
}: CanvasProps) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [connecting, setConnecting] = useState<string | null>(null);
  // A monotonically-increasing tick so <Wires> re-measures mid-drag.
  const [dragTick, setDragTick] = useState(0);

  const beginDrag = useCallback(
    (node: PipelineNode, e: React.PointerEvent): void => {
      const pos = node.pos ?? FALLBACK_POS;
      dragRef.current = { id: node.id, dx: e.clientX - pos.x, dy: e.clientY - pos.y };
      (e.target as Element).setPointerCapture?.(e.pointerId);
      e.preventDefault();
    },
    []
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent): void => {
      const drag = dragRef.current;
      if (!drag) {
        return;
      }
      const x = Math.max(0, e.clientX - drag.dx);
      const y = Math.max(0, e.clientY - drag.dy);
      onMove(drag.id, { x, y });
      setDragTick((t) => t + 1);
    },
    [onMove]
  );

  const endDrag = useCallback((e: React.PointerEvent): void => {
    if (dragRef.current) {
      (e.target as Element).releasePointerCapture?.(e.pointerId);
    }
    dragRef.current = null;
  }, []);

  const onOutputClick = useCallback(
    (nodeId: string): void => {
      setConnecting(nodeId);
      setStatus('Click a matching input port to connect…');
    },
    [setStatus]
  );

  const onInputClick = useCallback(
    (nodeId: string, port: string): void => {
      if (!connecting) {
        return;
      }
      onConnect(connecting, nodeId, port);
      setConnecting(null);
    },
    [connecting, onConnect]
  );

  const onCanvasPointerDown = useCallback(
    (e: React.PointerEvent): void => {
      // A bare click on the canvas clears any in-progress connection + selection.
      if (e.target === canvasRef.current) {
        setConnecting(null);
        setStatus('');
        onSelect(null);
      }
    },
    [onSelect, setStatus]
  );

  const onDrop = useCallback(
    (e: React.DragEvent): void => {
      const type = e.dataTransfer.getData('application/x-ps-block');
      if (!type) {
        return;
      }
      e.preventDefault();
      const canvas = canvasRef.current;
      if (!canvas) {
        return;
      }
      const cr = canvas.getBoundingClientRect();
      const pos = {
        x: Math.max(0, e.clientX - cr.left + canvas.scrollLeft - 80),
        y: Math.max(0, e.clientY - cr.top + canvas.scrollTop - 16)
      };
      onAddAt(type, pos);
    },
    [onAddAt]
  );

  return (
    <div className="ps-canvas-wrap">
      <div
        className="ps-canvas"
        id="ps-canvas"
        ref={canvasRef}
        onPointerDown={onCanvasPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
        }}
        onDrop={onDrop}
      >
        <Wires
          pipeline={pipeline}
          canvasRef={canvasRef}
          version={dragTick}
          onDeleteEdge={onDeleteEdge}
        />
        {pipeline.nodes.map((node) => {
          const meta: Pick<BlockTypeMeta, 'label' | 'inputs' | 'outputType'> =
            typeIndex[node.type] ?? { label: node.type, inputs: [], outputType: '?' };
          const pos = node.pos ?? FALLBACK_POS;
          const selected = selectedId === node.id;
          return (
            <div
              key={node.id}
              className={`ps-node${selected ? ' is-selected' : ''}`}
              data-node={node.id}
              style={{ left: pos.x, top: pos.y }}
              onPointerDown={() => {
                // Selecting on the card body; ports/delete stop propagation below.
                onSelect(node.id);
              }}
            >
              <div
                className="ps-node__hdr"
                onPointerDown={(e) => beginDrag(node, e)}
              >
                <span>{meta.label}</span>
                <button
                  className="ps-node__del"
                  type="button"
                  data-del={node.id}
                  title="Delete"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(node.id);
                  }}
                >
                  ✕
                </button>
              </div>
              <div className="ps-node__id">
                {node.id}
                {node.promptBody ? ' ·✎' : ''}
                {modelSuffix(node.model)}
              </div>
              <div className="ps-node__ports">
                <div className="ps-ports-in">
                  {(meta.inputs || []).map((p) => (
                    <div
                      key={p.name}
                      className="ps-port ps-port--in"
                      data-port-node={node.id}
                      data-port-name={p.name}
                      data-type={p.type}
                      title={`${p.name}:${p.type}`}
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        onInputClick(node.id, p.name);
                      }}
                    >
                      <span className="ps-dot" />
                      <span className="ps-portlbl">{p.name}</span>
                    </div>
                  ))}
                </div>
                <div
                  className={`ps-port ps-port--out${connecting === node.id ? ' is-connecting' : ''}`}
                  data-port-node={node.id}
                  data-type={meta.outputType}
                  title={`out:${meta.outputType}`}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    onOutputClick(node.id);
                  }}
                >
                  <span className="ps-portlbl">{meta.outputType}</span>
                  <span className="ps-dot" />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
