import { useCallback, useEffect, useState } from 'react';
import {
  generatePipeline,
  listPipelines,
  savePipeline,
  type PipelineSummary
} from '../lib/api';

/** Built-in pipelines that are now top-level modes — hidden from the Customize gallery. */
const HIDDEN_BUILTIN_IDS = new Set(['builtin-expert', 'builtin-expert-fast']);

/** State + actions for the Customize-row template gallery + AI generator. */
export interface UseCustomizePipelines {
  /** Builtin + saved-custom pipelines to render as cards (Expert presets hidden). */
  pipelines: PipelineSummary[];
  /** True while the initial list (or a post-generate refresh) is loading. */
  loading: boolean;
  /** True while an AI generation + save is in flight. */
  generating: boolean;
  /** Status line under the AI input ('' when idle). */
  hint: string;
  /** Re-fetch the pipeline list (e.g. after generating a new one). */
  refresh: () => Promise<void>;
  /**
   * Generate a pipeline from a one-line prompt, persist it, and return its id so
   * the caller can activate it. Returns null on empty prompt / failure (the hint
   * carries the user-facing message in that case).
   */
  generate: (prompt: string) => Promise<string | null>;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return '请求失败';
}

/**
 * Drives the Customize-row template gallery: lazily loads the pipeline list when
 * the settings modal is `active`, and authors → saves a new pipeline from a
 * natural-language prompt. Mirrors the desktop `refreshCustomizePicker` /
 * `generatePipelineFromInput` flow (the desktop hides the Expert presets too).
 */
export function useCustomizePipelines(active: boolean): UseCustomizePipelines {
  const [pipelines, setPipelines] = useState<PipelineSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [hint, setHint] = useState('');

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const res = await listPipelines();
      setPipelines(res.pipelines.filter((p) => !HIDDEN_BUILTIN_IDS.has(p.id)));
    } catch (error: unknown) {
      setHint(`无法加载模板：${getErrorMessage(error)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  // Load the gallery the first time the modal becomes active in Customize mode.
  useEffect(() => {
    if (active) {
      void refresh();
    }
  }, [active, refresh]);

  const generate = useCallback(
    async (prompt: string): Promise<string | null> => {
      const trimmed = prompt.trim();
      if (trimmed.length === 0) {
        setHint('先用一句话描述这次面试');
        return null;
      }
      setGenerating(true);
      setHint('AI 正在生成面试方案…');
      try {
        const { pipeline } = await generatePipeline(trimmed);
        const { id } = await savePipeline(pipeline);
        await refresh();
        setHint(`已生成并启用：${pipeline.name}`);
        return id;
      } catch (error: unknown) {
        setHint(`生成失败：${getErrorMessage(error)}`);
        return null;
      } finally {
        setGenerating(false);
      }
    },
    [refresh]
  );

  return { pipelines, loading, generating, hint, refresh, generate };
}
