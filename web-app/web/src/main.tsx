import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Shell } from './desktop/Shell';

// GLP design-system theme foundation. MUST be the first CSS import so every
// downstream consumer resolves against the shared tokens (light by default;
// html[data-theme="dark"] overrides). See desktop-ui/theme.css + lib/useTheme.ts.
import './desktop-ui/theme.css';

// Desktop CSS, copied verbatim into ./desktop-ui and imported in the SAME order
// as the desktop renderer.html: styles.css (shell + tokens + fonts) first, then
// the feature partials. This is what gives the web client the identical look,
// tokens, and launch/entrance animations.
import './desktop-ui/styles.css';
import './desktop-ui/history-sidebar.css';
import './desktop-ui/channel-control.css';
import './desktop-ui/resume-dropzone.css';
import './desktop-ui/chat.css';
import './desktop-ui/session-context.css';
import './desktop-ui/interview-type.css';
import './desktop-ui/settings.css';
// Pipeline Studio (Customize-mode node editor) — copied verbatim from the desktop.
import './desktop-ui/studio.css';
// Web-only additions: question-card sub-blocks + the namespaced Question Bank.
import './web-extras.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element #root not found');
}

createRoot(container).render(
  <StrictMode>
    <Shell />
  </StrictMode>
);
