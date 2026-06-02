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
    label: 'Toggle transcription',
    description: 'Start / stop live audio capture',
    keys: 'Ctrl+Shift+T'
  },
  {
    id: 'askAi',
    label: 'Ask AI',
    description: 'Open the assistant on the current context',
    keys: 'Ctrl+Shift+A'
  },
  {
    id: 'generateQuestion',
    label: 'Generate Q',
    description: 'Generate a follow-up question',
    keys: 'Ctrl+Enter'
  },
  {
    id: 'clearSession',
    label: 'Clear session',
    description: 'Reset the current answer buffer',
    keys: 'Ctrl+Shift+Backspace'
  }
];
