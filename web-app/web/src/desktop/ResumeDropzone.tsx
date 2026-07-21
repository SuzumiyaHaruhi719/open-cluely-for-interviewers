import { useCallback, useEffect, useRef, useState } from 'react';
import { UploadSimple } from '@phosphor-icons/react/UploadSimple';
import { X } from '@phosphor-icons/react/X';
import { extractResume, ApiError } from '../lib/api';
import {
  RESUME_ACCEPT_ATTR,
  RESUME_ACCEPT_HINT,
  formatCharCount,
  readFileAsBase64
} from '../lib/resumeFile';

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
  const [filename, setFilename] = useState(resumeText ? '已保存的简历' : '');
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
      setFilename((prev) => (prev && prev !== '已保存的简历' ? prev : '已保存的简历'));
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
      setAnnounce(`正在读取 ${file.name || '文件'}…`);
      try {
        const contentBase64 = await readFileAsBase64(file);
        const res = await extractResume({ filename: file.name, contentBase64 });
        const text = res.text ?? '';
        setState('parsed');
        setFilename(file.name || '简历');
        setChars(text.length);
        setPreview(previewOf(text));
        setAnnounce(`简历已加载：${file.name || '文件'}，${formatCharCount(text.length)}。`);
        onExtracted(text);
      } catch (err: unknown) {
        const message =
          err instanceof ApiError || err instanceof Error
            ? err.message
            : '无法读取简历';
        setState('error');
        setErrorText(message);
        setAnnounce(`简历上传失败。${message}`);
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
      setErrorText('无法读取拖入的文件，请点击选择文件重试');
    }
  };

  const handleRemove = (event: React.MouseEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    setState('idle');
    setErrorText('');
    setAnnounce('简历已移除。');
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
        aria-label={`上传简历。${RESUME_ACCEPT_HINT}。拖入文件，或按 Enter 选择文件。`}
        onClick={() => inputRef.current?.click()}
      >
        <span className="resume-dropzone__icon" aria-hidden="true">
          <UploadSimple size={22} data-icon-library="phosphor" />
        </span>
        <span className="resume-dropzone__primary">拖入简历或点击选择文件</span>
        <span className="resume-dropzone__hint">{RESUME_ACCEPT_HINT}</span>
      </button>

      <div className="resume-dropzone__result" hidden={state !== 'parsed'}>
        <div className="resume-dropzone__meta">
          <span className="resume-dropzone__filename">{filename}</span>
          <span className="resume-dropzone__count">{formatCharCount(chars)}</span>
          <button
            type="button"
            className="resume-dropzone__remove"
            aria-label="移除简历"
            title="移除简历"
            onClick={handleRemove}
          >
            <X size={14} weight="bold" aria-hidden="true" data-icon-library="phosphor" />
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
