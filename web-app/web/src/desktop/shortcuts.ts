/**
 * Static keyboard-shortcut list shown (read-only) in the settings panel,
 * mirroring the desktop's `settings-shortcuts-list`. The desktop derives these
 * from `src/config.js`; the web shell hard-codes a representative set since the
 * browser cannot register global accelerators. Display strings follow the
 * desktop's "Ctrl+Shift+X" formatting.
 */
export interface ShortcutDef {
  id: string;
  label: string;
  description: string;
  keys: string;
}

export const SHORTCUTS: ReadonlyArray<ShortcutDef> = [
  {
    id: 'toggleTranscription',
    label: '切换转写',
    description: '开始或停止实时音频采集',
    keys: 'Ctrl+Shift+T'
  },
  {
    id: 'askAi',
    label: '提问 AI',
    description: '基于当前上下文打开助手',
    keys: 'Ctrl+Shift+A'
  },
  {
    id: 'generateQuestion',
    label: '生成追问',
    description: '生成一个追问问题',
    keys: 'Ctrl+Enter'
  },
  {
    id: 'clearSession',
    label: '清空会话',
    description: '重置当前回答缓存',
    keys: 'Ctrl+Shift+Backspace'
  }
];
