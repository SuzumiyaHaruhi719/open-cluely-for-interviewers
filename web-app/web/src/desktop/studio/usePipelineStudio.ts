import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ApiError,
  fetchBlockTypes,
  fetchPipeline,
  fetchPipelines,
  savePipeline as savePipelineApi,
  validatePipeline as validatePipelineApi,
  type BlockTypeMeta,
  type Pipeline,
  type PipelineEdge,
  type PipelineNode,
  type PipelineSummary
} from '../../lib/api';
import {
  addNode,
  buildForSave,
  cloneAsNew,
  connect,
  indexTypes,
  moveNode,
  nextNodeId,
  removeEdge,
  removeNode,
  updateNode,
  type TypeIndex
} from './studioState';

/** Status line under the canvas (mirrors `.ps-status` with `data-kind`). */
export interface StudioStatus {
  message: string;
  kind: '' | 'ok' | 'error';
}

const EMPTY_PIPELINE: Pipeline = { id: '', name: '我的流程', nodes: [], edges: [] };
const NEW_NODE_OFFSET = 40;

function getErrorMessage(err: unknown): string {
  if (err instanceof ApiError || err instanceof Error) {
    return err.message;
  }
  return '请求失败';
}

/** Where a freshly-added node lands (cascades so stacked adds don't overlap). */
function placementFor(count: number): { x: number; y: number } {
  return { x: 60 + (count % 5) * NEW_NODE_OFFSET, y: 60 + (count % 6) * 30 };
}

export interface PipelineStudioState {
  blockTypes: BlockTypeMeta[];
  typeIndex: TypeIndex;
  library: PipelineSummary[];
  pipeline: Pipeline;
  name: string;
  selectedId: string | null;
  selectedNode: PipelineNode | null;
  status: StudioStatus;
  dirty: boolean;
  loading: boolean;
  /** Load the catalog + library; seed a clone of Expert. Call when opening. */
  init: () => Promise<void>;
  setName: (name: string) => void;
  select: (id: string | null) => void;
  newFromExpert: () => Promise<void>;
  loadPipeline: (id: string) => Promise<void>;
  addBlock: (type: string) => void;
  addBlockAt: (type: string, pos: { x: number; y: number }) => void;
  deleteNode: (id: string) => void;
  moveNodeTo: (id: string, pos: { x: number; y: number }) => void;
  patchNode: (id: string, patch: Partial<PipelineNode>) => void;
  connectPorts: (fromNode: string, toNode: string, toPort: string) => void;
  deleteEdge: (edge: PipelineEdge) => void;
  setStatus: (message: string, kind?: StudioStatus['kind']) => void;
  validate: () => Promise<boolean>;
  save: () => Promise<string | null>;
}

/**
 * Editing state for the Pipeline Studio: the block-type catalog, the saved-
 * pipeline library, the working pipeline graph (nodes+positions, edges, per-node
 * config), the name + selection + dirty flag, and the status line. Graph edits go
 * through the pure helpers in studioState.ts (immutable); fetches talk to
 * /api/pipelines. The "Use this" activation lives in the component (it needs the
 * live socket); this hook exposes `save` + the resulting id for it.
 */
export function usePipelineStudio(): PipelineStudioState {
  const [blockTypes, setBlockTypes] = useState<BlockTypeMeta[]>([]);
  const [library, setLibrary] = useState<PipelineSummary[]>([]);
  const [pipeline, setPipeline] = useState<Pipeline>(EMPTY_PIPELINE);
  const [name, setNameState] = useState('我的流程');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [status, setStatusState] = useState<StudioStatus>({ message: '', kind: '' });
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(false);

  const seqRef = useRef(0);
  const typeIndex = useMemo(() => indexTypes(blockTypes), [blockTypes]);

  const selectedNode = useMemo(
    () => (selectedId ? pipeline.nodes.find((n) => n.id === selectedId) ?? null : null),
    [selectedId, pipeline.nodes]
  );

  const setStatus = useCallback((message: string, kind: StudioStatus['kind'] = ''): void => {
    setStatusState({ message, kind });
  }, []);

  const setName = useCallback((next: string): void => {
    setNameState(next);
    setDirty(true);
  }, []);

  const select = useCallback((id: string | null): void => {
    setSelectedId(id);
  }, []);

  const refreshLibrary = useCallback(async (): Promise<void> => {
    try {
      const res = await fetchPipelines();
      setLibrary(res.pipelines);
    } catch (err) {
      setStatus(`无法加载流程：${getErrorMessage(err)}`, 'error');
    }
  }, [setStatus]);

  // Seed the canvas from the Expert preset as a fresh editable copy.
  const newFromExpert = useCallback(async (): Promise<void> => {
    try {
      const res = await fetchPipeline('builtin-expert');
      const next = cloneAsNew(res.pipeline);
      setPipeline(next);
      setNameState(next.name);
      setSelectedId(null);
      setDirty(false);
      setStatus('已克隆专家流程，可以编辑后保存或启用。');
    } catch (err) {
      setStatus(`无法克隆专家流程：${getErrorMessage(err)}`, 'error');
    }
  }, [setStatus]);

  const loadPipeline = useCallback(
    async (id: string): Promise<void> => {
      if (!id) {
        await newFromExpert();
        return;
      }
      try {
        const res = await fetchPipeline(id);
        const loaded: Pipeline = JSON.parse(JSON.stringify(res.pipeline));
        setPipeline(loaded);
        setNameState(loaded.name || '');
        setSelectedId(null);
        setDirty(false);
        setStatus(
          loaded.builtin ? '内置预设：保存时会创建一个可编辑副本。' : ''
        );
      } catch (err) {
        setStatus(`加载流程失败：${getErrorMessage(err)}`, 'error');
      }
    },
    [newFromExpert, setStatus]
  );

  const init = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const [types] = await Promise.all([fetchBlockTypes(), refreshLibrary()]);
      setBlockTypes(types.blockTypes);
      await newFromExpert();
    } catch (err) {
      setStatus(`无法加载编辑器：${getErrorMessage(err)}`, 'error');
    } finally {
      setLoading(false);
    }
  }, [refreshLibrary, newFromExpert, setStatus]);

  const addBlockAt = useCallback(
    (type: string, pos: { x: number; y: number }): void => {
      setPipeline((prev) => {
        const { id, seq } = nextNodeId(prev, type, seqRef.current + 1);
        seqRef.current = seq;
        const next = addNode(prev, typeIndex, type, id, pos);
        if (next !== prev) {
          setSelectedId(id);
          setDirty(true);
        }
        return next;
      });
    },
    [typeIndex]
  );

  const addBlock = useCallback(
    (type: string): void => {
      setPipeline((prev) => {
        const { id, seq } = nextNodeId(prev, type, seqRef.current + 1);
        seqRef.current = seq;
        const next = addNode(prev, typeIndex, type, id, placementFor(prev.nodes.length));
        if (next !== prev) {
          setSelectedId(id);
          setDirty(true);
        }
        return next;
      });
    },
    [typeIndex]
  );

  const deleteNode = useCallback((id: string): void => {
    setPipeline((prev) => removeNode(prev, id));
    setSelectedId((cur) => (cur === id ? null : cur));
    setDirty(true);
  }, []);

  const moveNodeTo = useCallback((id: string, pos: { x: number; y: number }): void => {
    setPipeline((prev) => moveNode(prev, id, pos));
    setDirty(true);
  }, []);

  const patchNode = useCallback((id: string, patch: Partial<PipelineNode>): void => {
    setPipeline((prev) => updateNode(prev, id, patch));
    setDirty(true);
  }, []);

  const connectPorts = useCallback(
    (fromNode: string, toNode: string, toPort: string): void => {
      setPipeline((prev) => {
        const result = connect(prev, typeIndex, fromNode, toNode, toPort);
        if (result.error) {
          setStatus(result.error, 'error');
          return prev;
        }
        setStatus('');
        setDirty(true);
        return result.pipeline;
      });
    },
    [typeIndex, setStatus]
  );

  const deleteEdge = useCallback((edge: PipelineEdge): void => {
    setPipeline((prev) => removeEdge(prev, edge));
    setDirty(true);
  }, []);

  const validate = useCallback(async (): Promise<boolean> => {
    const candidate = buildForSave(pipeline, name);
    try {
      const res = await validatePipelineApi(candidate);
      if (res.ok) {
        setStatus('校验通过 ✓', 'ok');
        return true;
      }
      setStatus(`校验失败：${(res.errors.length ? res.errors : ['未知错误']).join('; ')}`, 'error');
      return false;
    } catch (err) {
      setStatus(`校验失败：${getErrorMessage(err)}`, 'error');
      return false;
    }
  }, [pipeline, name, setStatus]);

  const save = useCallback(async (): Promise<string | null> => {
    const candidate = buildForSave(pipeline, name);
    try {
      const res = await savePipelineApi(candidate);
      // Adopt the saved id so subsequent saves overwrite in place.
      setPipeline((prev) => ({ ...prev, id: res.id, builtin: false }));
      setDirty(false);
      setStatus(`已保存“${candidate.name}”`, 'ok');
      await refreshLibrary();
      return res.id;
    } catch (err) {
      setStatus(`保存失败：${getErrorMessage(err)}`, 'error');
      return null;
    }
  }, [pipeline, name, refreshLibrary, setStatus]);

  // Keep the name field and the pipeline's name in sync one-way (typing updates
  // the working pipeline too, so buildForSave + Export see the latest).
  useEffect(() => {
    setPipeline((prev) => (prev.name === name ? prev : { ...prev, name }));
  }, [name]);

  return {
    blockTypes,
    typeIndex,
    library,
    pipeline,
    name,
    selectedId,
    selectedNode,
    status,
    dirty,
    loading,
    init,
    setName,
    select,
    newFromExpert,
    loadPipeline,
    addBlock,
    addBlockAt,
    deleteNode,
    moveNodeTo,
    patchNode,
    connectPorts,
    deleteEdge,
    setStatus,
    validate,
    save
  };
}
