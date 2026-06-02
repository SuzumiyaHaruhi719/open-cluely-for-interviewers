import { useCallback, useEffect, useRef, useState } from 'react';
import { extractResume, ApiError } from '../lib/api';
import {
  RESUME_ACCEPT_ATTR,
  RESUME_ACCEPT_HINT,
  formatCharCount,
  readFileAsBase64
} from '../lib/resumeFile';
import { UploadIcon } from './icons';

type DropzoneState = 'idle' | 'parsing' | 'parsed' | 'error';
const PREVIEW_LINES = 2;

interface ResumeDropzoneProps {
  /** The current résumé text (drives the parsed-chip preview when present). */
  resumeText: string;
  /** Called with the extracted text after a successful upload. */
  onExtracted: (text: string) => void;
  /** Called when the user clears the résumé. */
  onCleared: () => void;
}

function previewOf(text: string): string {
  return text.split('\n').slice(0, PREVIEW_LINES).join('\n');
}

/**
 * Résumé drop-zone, reproducing the desktop `#resume-dropzone`
 * (resume-dropzone.css): a drag-and-drop / click-to-browse target that reads a
 * file in the browser, base64-encodes it, and POSTs to /api/resume/extract. On
 * success it lifts the returned text to the parent (which pushes it to the
 * session config + persists it). A document-level dragover/drop guard prevents
 * the browser from navigating away when a file is dropped outside the zone.
 */
export function ResumeDropzone({ resumeText, onExtracted, onCleared }: ResumeDropzoneProps) {
  const [state, setState] = useState<DropzoneState>(resumeText ? 'parsed' : 'idle');
  const [filename, setFilename] = useState(resumeText ? 'Saved resume' : '');
  const [chars, setChars] = useState(resumeText.length);
  const [preview, setPreview] = useState(resumeText ? previewOf(resumeText) : '');
  const [errorText, setErrorText] = useState('');
  const [announce, setAnnounce] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const dragDepthRef = useRef(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [dragOver, setDragOver] = useState(false);

  // Reflect a résumé supplied from outside (e.g. loaded from a session) into the
  // parsed chip without re-uploading. Skip while a parse is in flight.
  useEffect(() => {
    if (state === 'parsing') {
      return;
    }
    if (resumeText) {
      setState((prev) => (prev === 'parsed' ? prev : 'parsed'));
      setChars(resumeText.length);
      setPreview(previewOf(resumeText));
      setFilename((prev) => (prev && prev !== 'Saved resume' ? prev : 'Saved resume'));
    } else {
      setState('idle');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumeText]);

  // Browsers navigate the whole window to a file dropped anywhere unless the
  // default is prevented at the document level; this guard also makes the page a
  // valid drop target. The zone's own handlers stopPropagation, so this only
  // swallows drops OUTSIDE the zone.
  useEffect(() => {
    const prevent = (event: DragEvent): void => event.preventDefault();
    window.addEventListener('dragover', prevent);
    window.addEventListener('drop', prevent);
    return () => {
      window.removeEventListener('dragover', prevent);
      window.removeEventListener('drop', prevent);
    };
  }, []);

  const handleFile = useCallback(
    async (file: File | null): Promise<void> => {
      if (!file) {
        return;
      }
      setState('parsing');
      setErrorText('');
      setAnnounce(`Reading ${file.name || 'file'}…`);
      try {
        const contentBase64 = await readFileAsBase64(file);
        const res = await extractResume({ filename: file.name, contentBase64 });
        const text = res.text ?? '';
        setState('parsed');
        setFilename(file.name || 'Resume');
        setChars(text.length);
        setPreview(previewOf(text));
        setAnnounce(`Resume loaded: ${file.name || 'file'}, ${formatCharCount(text.length)}.`);
        onExtracted(text);
      } catch (err: unknown) {
        const message =
          err instanceof ApiError || err instanceof Error
            ? err.message
            : 'Could not read resume';
        setState('error');
        setErrorText(message);
        setAnnounce(`Resume upload failed. ${message}`);
      }
    },
    [onExtracted]
  );

  const isDraggingFiles = (event: React.DragEvent): boolean =>
    Array.prototype.indexOf.call(event.dataTransfer.types, 'Files') !== -1;

  const onDragEnter = (event: React.DragEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current += 1;
    if (isDraggingFiles(event)) {
      setDragOver(true);
    }
  };
  const onDragOver = (event: React.DragEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'copy';
    if (isDraggingFiles(event)) {
      setDragOver(true);
    }
  };
  const onDragLeave = (event: React.DragEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setDragOver(false);
    }
  };
  const onDrop = (event: React.DragEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current = 0;
    setDragOver(false);
    const file = event.dataTransfer.files?.[0] ?? null;
    if (file) {
      void handleFile(file);
    } else {
      setState('error');
      setErrorText('Could not read the dropped file — try clicking to browse');
    }
  };

  const handleRemove = (event: React.MouseEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    setState('idle');
    setErrorText('');
    setAnnounce('Resume removed.');
    onCleared();
  };

  const rootClass = `resume-dropzone${dragOver ? ' is-dragover' : ''}`;

  return (
    <div
      id="resume-dropzone"
      className={rootClass}
      data-state={state}
      ref={rootRef}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <button
        type="button"
        className="resume-dropzone__target"
        aria-label={`Upload resume. ${RESUME_ACCEPT_HINT}. Drop a file here or press Enter to browse.`}
        onClick={() => inputRef.current?.click()}
      >
        <span className="resume-dropzone__icon" aria-hidden="true">
          <UploadIcon size={22} />
        </span>
        <span className="resume-dropzone__primary">Drop resume or click to browse</span>
        <span className="resume-dropzone__hint">{RESUME_ACCEPT_HINT}</span>
      </button>

      <div className="resume-dropzone__result" hidden={state !== 'parsed'}>
        <div className="resume-dropzone__meta">
          <span className="resume-dropzone__filename">{filename}</span>
          <span className="resume-dropzone__count">{formatCharCount(chars)}</span>
          <button
            type="button"
            className="resume-dropzone__remove"
            aria-label="Remove resume"
            title="Remove resume"
            onClick={handleRemove}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <p className="resume-dropzone__preview">{preview}</p>
      </div>

      <p className="resume-dropzone__error" hidden={state !== 'error'}>
        {errorText}
      </p>

      <input
        ref={inputRef}
        type="file"
        className="resume-dropzone__input"
        accept={RESUME_ACCEPT_ATTR}
        hidden
        aria-hidden="true"
        tabIndex={-1}
        onChange={(e) => {
          void handleFile(e.target.files?.[0] ?? null);
          e.target.value = '';
        }}
      />
      <span className="resume-dropzone__live" aria-live="polite" role="status">
        {announce}
      </span>
    </div>
  );
}
