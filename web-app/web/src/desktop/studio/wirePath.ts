// Tiny SVG cubic-bezier path helper for wires (no dependency). Mirrors the
// desktop drawWires() curve: a horizontal-tangent cubic between two port centers
// with a control-point offset proportional to the horizontal gap.

export interface Point {
  x: number;
  y: number;
}

const MIN_CTRL_OFFSET = 30;

/** A smooth left→right cubic bezier `d` attribute between two points. */
export function wirePath(a: Point, b: Point): string {
  const dx = Math.max(MIN_CTRL_OFFSET, Math.abs(b.x - a.x) / 2);
  return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y} ${b.x - dx} ${b.y} ${b.x} ${b.y}`;
}
