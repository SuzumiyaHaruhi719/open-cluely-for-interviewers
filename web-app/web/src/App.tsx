import { useState } from 'react';
import { useCopilotSocket } from './lib/useCopilotSocket';
import { LiveCopilot } from './views/LiveCopilot';
import { QuestionBank } from './views/QuestionBank';

type View = 'copilot' | 'bank';

const NAV: ReadonlyArray<{ id: View; label: string }> = [
  { id: 'copilot', label: 'Live Copilot' },
  { id: 'bank', label: 'Question Bank' }
];

export function App() {
  const [view, setView] = useState<View>('copilot');

  // The socket lives at the app root so the live session survives navigation
  // between the two views.
  const socket = useCopilotSocket();

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-brand">
          <span className="app-brand-mark" aria-hidden="true" />
          Interviewer Copilot
        </div>
        <nav className="app-nav" aria-label="Primary">
          {NAV.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`nav-tab${view === item.id ? ' is-active' : ''}`}
              aria-current={view === item.id ? 'page' : undefined}
              onClick={() => setView(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </header>

      <main className="app-main">
        {/* Keep LiveCopilot mounted so its local state and the socket-driven
            result persist while the user browses the question bank. */}
        <div style={{ height: '100%', display: view === 'copilot' ? 'block' : 'none' }}>
          <LiveCopilot socket={socket} />
        </div>
        {view === 'bank' ? <QuestionBank /> : null}
      </main>
    </div>
  );
}
