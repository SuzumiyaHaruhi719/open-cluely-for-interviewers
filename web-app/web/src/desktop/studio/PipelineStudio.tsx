import { useEffect } from 'react';
import { buildForSave } from './studioState';
import { usePipelineStudio } from './usePipelineStudio';
import { StudioTopbar } from './StudioTopbar';
import { Palette } from './Palette';
import { Canvas } from './Canvas';
import { ConfigPanel } from './ConfigPanel';

interface PipelineStudioProps {
  open: boolean;
  onClose: () => void;
  /** Called after a successful Save in the "Use this" flow: activate + run it. */
  onUse: (id: string, name: string) => void;
}

/** Download a pipeline as a JSON file (the Export action). */
function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Pipeline Studio — the full-window Customize-mode node editor. Reproduces the
 * desktop `#pipeline-studio` markup: `.ps-topbar` (library picker, name, actions)
 * over `.ps-body` (`.ps-palette` · `.ps-canvas-wrap` · `.ps-config`) over
 * `.ps-status`. State + fetches live in `usePipelineStudio`; this component owns
 * the layout, the open/close lifecycle, and the topbar action handlers.
 */
export function PipelineStudio({ open, onClose, onUse }: PipelineStudioProps) {
  const studio = usePipelineStudio();
  const { init } = studio;

  // Load the catalog + library and seed a clone of Expert each time we open.
  useEffect(() => {
    if (open) {
      void init();
    }
  }, [open, init]);

  // Escape closes the studio.
  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  const onExport = (): void => {
    const p = buildForSave(studio.pipeline, studio.name);
    downloadJson(`${p.id || 'pipeline'}.json`, p);
    studio.setStatus('Exported pipeline JSON', 'ok');
  };

  const onUseThis = async (): Promise<void> => {
    if (!(await studio.validate())) {
      return;
    }
    const id = await studio.save();
    if (!id) {
      return;
    }
    studio.setStatus(`Active: ${studio.name} (Customize mode)`, 'ok');
    onUse(id, studio.name);
    onClose();
  };

  return (
    <div
      id="pipeline-studio"
      className={`pipeline-studio${open ? '' : ' hidden'}`}
      role="dialog"
      aria-modal="true"
      aria-label="Pipeline Studio"
    >
      <StudioTopbar
        library={studio.library}
        currentId={studio.pipeline.id}
        name={studio.name}
        onPick={(id) => void studio.loadPipeline(id)}
        onNameChange={studio.setName}
        onValidate={() => void studio.validate()}
        onSave={() => void studio.save()}
        onUse={() => void onUseThis()}
        onExport={onExport}
        onClose={onClose}
      />
      <div className="ps-body">
        <Palette blockTypes={studio.blockTypes} onAdd={studio.addBlock} />
        <Canvas
          pipeline={studio.pipeline}
          typeIndex={studio.typeIndex}
          selectedId={studio.selectedId}
          onSelect={studio.select}
          onMove={studio.moveNodeTo}
          onDelete={studio.deleteNode}
          onConnect={studio.connectPorts}
          onDeleteEdge={studio.deleteEdge}
          onAddAt={studio.addBlockAt}
          setStatus={studio.setStatus}
        />
        <ConfigPanel
          node={studio.selectedNode}
          typeIndex={studio.typeIndex}
          onPatch={studio.patchNode}
        />
      </div>
      <footer className="ps-status" id="ps-status" data-kind={studio.status.kind}>
        {studio.status.message}
      </footer>
    </div>
  );
}
