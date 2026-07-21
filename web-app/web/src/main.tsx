import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Shell } from './desktop/Shell';
import { ErrorBoundary } from './components/ErrorBoundary';

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
// Web-only additions: question-card sub-blocks + the namespaced Question Bank.
import './web-extras.css';
// Final GLP simplification layer for the one-shot interviewer experience.
import './desktop-ui/one-shot-interview.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element #root not found');
}

createRoot(container).render(
  <StrictMode>
    <ErrorBoundary>
      <Shell />
    </ErrorBoundary>
  </StrictMode>
);
