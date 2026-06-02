import { useLayoutEffect, useState } from 'react';
import type { Pipeline, PipelineEdge } from '../../lib/api';
import { wirePath, type Point } from './wirePath';

interface WiresProps {
  pipeline: Pipeline;
  /** The scrollable `.ps-canvas` element wires are measured relative to. */
  canvasRef: React.RefObject<HTMLDivElement>;
  /** Bumps to force a re-measure (e.g. during a node drag). */
  version: number;
  onDeleteEdge: (edge: PipelineEdge) => void;
}

interface DrawnWire {
  edge: PipelineEdge;
  d: string;
}

/** Center of a port's dot relative to the canvas content (incl. scroll). */
function portCenter(
  canvas: HTMLDivElement,
  selector: string
): Point | null {
  const port = canvas.querySelector(selector);
  if (!port) {
    return null;
  }
  const dot = port.querySelector('.ps-dot') ?? port;
  const cr = canvas.getBoundingClientRect();
  const r = dot.getBoundingClientRect();
  return {
    x: r.left + r.width / 2 - cr.left + canvas.scrollLeft,
    y: r.top + r.height / 2 - cr.top + canvas.scrollTop
  };
}

/**
 * SVG wire layer (`.ps-wires`): one `.ps-wire` cubic path per edge, measured from
 * the live port-dot DOM centers so wires track nodes as they move. Clicking a
 * wire deletes it (the path is given pointer events; the layer itself stays
 * click-through, matching the desktop CSS). Re-measures on pipeline/version change.
 */
export function Wires({ pipeline, canvasRef, version, onDeleteEdge }: WiresProps) {
  const [wires, setWires] = useState<DrawnWire[]>([]);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      setWires([]);
      return;
    }
    const drawn: DrawnWire[] = [];
    for (const edge of pipeline.edges) {
      const a = portCenter(canvas, `.ps-port--out[data-port-node="${edge.fromNode}"]`);
      const b = portCenter(
        canvas,
        `.ps-port--in[data-port-node="${edge.toNode}"][data-port-name="${edge.toPort}"]`
      );
      if (!a || !b) {
        continue;
      }
      drawn.push({ edge, d: wirePath(a, b) });
    }
    setWires(drawn);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pipeline, version, canvasRef]);

  return (
    <svg className="ps-wires" id="ps-wires">
      {wires.map((w, i) => (
        <path
          key={`${w.edge.fromNode}->${w.edge.toNode}.${w.edge.toPort}-${i}`}
          className="ps-wire"
          d={w.d}
          style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
          onClick={() => onDeleteEdge(w.edge)}
        >
          <title>Click to delete</title>
        </path>
      ))}
    </svg>
  );
}
