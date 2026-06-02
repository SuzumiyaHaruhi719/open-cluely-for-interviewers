import { useEffect, useRef, useState } from 'react';
import type { PipelineSummary } from '../../lib/api';

interface StudioTopbarProps {
  library: readonly PipelineSummary[];
  /** id of the currently-loaded pipeline ('' = New / clone Expert). */
  currentId: string;
  name: string;
  onPick: (id: string) => void;
  onNameChange: (name: string) => void;
  onValidate: () => void;
  onSave: () => void;
  onUse: () => void;
  onExport: () => void;
  onClose: () => void;
}

const NEW_LABEL = '+ New (clone Expert)';

/**
 * Studio topbar (`.ps-topbar`): title, the library picker (a custom
 * button+menu — `.ps-libpick`, matching the desktop, which avoids native
 * <select> popups), the name field, and the Validate / Save / Use this / Export /
 * Close actions. Maps to `#ps-library`, `#ps-name`, and the `#ps-*` buttons.
 */
export function StudioTopbar({
  library,
  currentId,
  name,
  onPick,
  onNameChange,
  onValidate,
  onSave,
  onUse,
  onExport,
  onClose
}: StudioTopbarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const pickRef = useRef<HTMLDivElement>(null);

  // Click-away closes the menu (matches the desktop behavior).
  useEffect(() => {
    if (!menuOpen) {
      return;
    }
    const onDocClick = (e: MouseEvent): void => {
      if (pickRef.current && !pickRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [menuOpen]);

  const current = library.find((p) => p.id === currentId);
  const buttonLabel = current ? `${current.builtin ? '★ ' : ''}${current.name}` : NEW_LABEL;

  return (
    <header className="ps-topbar">
      <span className="ps-title">Pipeline Studio</span>
      <div id="ps-library" className="ps-libpick" ref={pickRef}>
        <button
          type="button"
          id="ps-library-btn"
          className="ps-select ps-libpick__btn"
          aria-haspopup="listbox"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
        >
          {buttonLabel} ▾
        </button>
        <div
          id="ps-library-menu"
          className={`ps-libpick__menu${menuOpen ? '' : ' hidden'}`}
          role="listbox"
        >
          <button
            type="button"
            className="ps-libpick__item"
            role="option"
            aria-selected={currentId === ''}
            data-pid=""
            onClick={() => {
              setMenuOpen(false);
              onPick('');
            }}
          >
            {NEW_LABEL}
          </button>
          {library.map((p) => (
            <button
              key={p.id}
              type="button"
              className="ps-libpick__item"
              role="option"
              aria-selected={currentId === p.id}
              data-pid={p.id}
              onClick={() => {
                setMenuOpen(false);
                onPick(p.id);
              }}
            >
              {p.builtin ? '★ ' : ''}
              {p.name}
            </button>
          ))}
        </div>
      </div>
      <input
        id="ps-name"
        className="ps-input"
        placeholder="Pipeline name"
        value={name}
        onChange={(e) => onNameChange(e.target.value)}
      />
      <span className="ps-spacer" />
      <button id="ps-validate" className="ps-btn" type="button" onClick={onValidate}>
        Validate
      </button>
      <button id="ps-save" className="ps-btn" type="button" onClick={onSave}>
        Save
      </button>
      <button id="ps-use" className="ps-btn ps-btn--primary" type="button" onClick={onUse}>
        Use this
      </button>
      <button id="ps-export" className="ps-btn" type="button" onClick={onExport}>
        Export
      </button>
      <button id="ps-close" className="ps-btn" type="button" aria-label="Close" onClick={onClose}>
        ✕
      </button>
    </header>
  );
}
