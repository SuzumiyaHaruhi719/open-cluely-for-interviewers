import type { BlockTypeMeta } from '../../lib/api';

interface PaletteProps {
  blockTypes: readonly BlockTypeMeta[];
  onAdd: (type: string) => void;
}

/** A block-type's input summary for the hover title (e.g. "claims, gaps → candidates"). */
function portSummary(meta: BlockTypeMeta): string {
  const ins = (meta.inputs || []).map((p) => p.type).join(', ') || '—';
  return `in: ${ins} → ${meta.outputType}`;
}

/**
 * Left palette (`.ps-palette`): one button per block type. Click adds a node to
 * the canvas; the buttons are also draggable (HTML5 DnD) — the canvas accepts a
 * drop at the cursor. Maps to the desktop `#ps-palette` list.
 */
export function Palette({ blockTypes, onAdd }: PaletteProps) {
  return (
    <aside className="ps-palette" id="ps-palette">
      <div className="ps-palette__title">Blocks</div>
      {blockTypes.map((meta) => (
        <button
          key={meta.id}
          type="button"
          className="ps-palette__item"
          data-add={meta.id}
          title={portSummary(meta)}
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData('application/x-ps-block', meta.id);
            e.dataTransfer.effectAllowed = 'copy';
          }}
          onClick={() => onAdd(meta.id)}
        >
          {meta.label}
          <span className="ps-palette__type">{meta.outputType}</span>
        </button>
      ))}
    </aside>
  );
}
