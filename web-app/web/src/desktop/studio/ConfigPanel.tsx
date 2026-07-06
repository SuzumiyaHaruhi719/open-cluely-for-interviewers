import type { BlockTypeMeta, BlockThinking, PipelineNode } from '../../lib/api';
import type { TypeIndex } from './studioState';

interface ConfigPanelProps {
  node: PipelineNode | null;
  typeIndex: TypeIndex;
  onPatch: (id: string, patch: Partial<PipelineNode>) => void;
}

// DashScope models the editor offers (same set the desktop Studio exposes). A
// node whose loaded default references another model keeps it as an extra option.
const MODELS = ['deepseek-v4-flash', 'deepseek-v4-pro'] as const;

const DEFAULT_BUDGET = 1024;
const DEFAULT_TEMP = 0.2;
const DEFAULT_MAX_TOKENS = 1200;

/** Resolve the effective thinking config (node override → type default → off). */
function effectiveThinking(node: PipelineNode, meta: BlockTypeMeta | undefined): BlockThinking {
  return node.thinking ?? meta?.defaults.thinking ?? { type: 'disabled' };
}

/**
 * Right config pane (`.ps-config`): per-node editor for the selected block —
 * model, thinking (on/off + token budget), temperature, max tokens, and the
 * prompt body. The body textarea is PRE-FILLED with the block-type's default so
 * users fine-tune it; leaving it equal to the default (or empty) stores no
 * override (the engine uses the builder default). Maps to `#ps-config`.
 */
export function ConfigPanel({ node, typeIndex, onPatch }: ConfigPanelProps) {
  if (!node) {
    return (
      <aside className="ps-config" id="ps-config">
        <div className="ps-config__empty">选择一个模块进行配置。</div>
      </aside>
    );
  }

  const meta = typeIndex[node.type];
  const thinking = effectiveThinking(node, meta);
  const thinkingOn = thinking.type === 'enabled';
  const defaultBody = meta?.defaultBody ?? '';
  const modelValue = node.model ?? meta?.defaults.model ?? MODELS[0];
  const modelOptions = MODELS.includes(modelValue as (typeof MODELS)[number])
    ? [...MODELS]
    : [...MODELS, modelValue];
  const tempValue = node.temperature ?? meta?.defaults.temperature ?? DEFAULT_TEMP;
  const maxTokensValue = node.maxTokens ?? meta?.defaults.maxTokens ?? DEFAULT_MAX_TOKENS;
  const bodyValue = node.promptBody ?? defaultBody;

  const onBodyChange = (val: string): void => {
    // Unchanged from the default (or emptied) → store nothing.
    const isDefault = val.trim() === defaultBody.trim() || val.trim() === '';
    onPatch(node.id, { promptBody: isDefault ? undefined : val });
  };

  return (
    <aside className="ps-config" id="ps-config">
      <h4 className="ps-config__title">
        {meta?.label ?? node.type} <span className="ps-config__id">{node.id}</span>
      </h4>

      <label className="ps-field">
        <span>模型</span>
        <select
          id="ps-f-model"
          value={modelValue}
          onChange={(e) => onPatch(node.id, { model: e.target.value })}
        >
          {modelOptions.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </label>

      <label className="ps-field ps-field--row">
        <span>深度思考</span>
        <input
          type="checkbox"
          id="ps-f-think"
          checked={thinkingOn}
          onChange={(e) =>
            onPatch(node.id, {
              thinking: e.target.checked
                ? { type: 'enabled', budget_tokens: thinking.budget_tokens ?? DEFAULT_BUDGET }
                : { type: 'disabled' }
            })
          }
        />
        <span className="ps-muted">预算</span>
        <input
          type="number"
          id="ps-f-budget"
          min={0}
          step={256}
          style={{ width: 80 }}
          disabled={!thinkingOn}
          value={thinkingOn ? thinking.budget_tokens ?? DEFAULT_BUDGET : DEFAULT_BUDGET}
          onChange={(e) =>
            onPatch(node.id, {
              thinking: { type: 'enabled', budget_tokens: Number(e.target.value) || DEFAULT_BUDGET }
            })
          }
        />
      </label>

      <label className="ps-field ps-field--row">
        <span>温度</span>
        <input
          type="number"
          id="ps-f-temp"
          min={0}
          max={1}
          step={0.05}
          style={{ width: 80 }}
          value={tempValue}
          onChange={(e) => onPatch(node.id, { temperature: Number(e.target.value) })}
        />
      </label>

      <label className="ps-field ps-field--row">
        <span>最大令牌数</span>
        <input
          type="number"
          id="ps-f-maxtokens"
          min={1}
          step={100}
          style={{ width: 100 }}
          value={maxTokensValue}
          onChange={(e) => onPatch(node.id, { maxTokens: Number(e.target.value) })}
        />
      </label>

      <label className="ps-field">
        <span>
          提示词正文：这里显示默认内容，可编辑微调（结构与输入保持固定）。保持不变则使用默认内容。
        </span>
        <textarea
          id="ps-f-body"
          rows={10}
          value={bodyValue}
          onChange={(e) => onBodyChange(e.target.value)}
        />
        <button
          type="button"
          id="ps-f-reset"
          className="ps-btn"
          style={{ alignSelf: 'flex-start', marginTop: 4 }}
          onClick={() => onPatch(node.id, { promptBody: undefined })}
        >
          恢复默认
        </button>
      </label>
    </aside>
  );
}
