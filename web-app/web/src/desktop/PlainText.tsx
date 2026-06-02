import { Fragment } from 'react';

interface PlainTextProps {
  text: string;
}

/**
 * Renders assistant/markdown-ish text safely as paragraphs + line breaks —
 * NEVER via dangerouslySetInnerHTML, so model output can't inject markup. Blank
 * lines split paragraphs; single newlines become <br>. This is deliberately
 * simple (per the spec: "simple line/para rendering is fine").
 */
export function PlainText({ text }: PlainTextProps) {
  const paragraphs = String(text ?? '')
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((para) => para.trim())
    .filter((para) => para.length > 0);

  if (paragraphs.length === 0) {
    return null;
  }

  return (
    <>
      {paragraphs.map((para, paraIndex) => {
        const lines = para.split('\n');
        return (
          <p key={paraIndex} className="plain-text__p">
            {lines.map((line, lineIndex) => (
              <Fragment key={lineIndex}>
                {lineIndex > 0 ? <br /> : null}
                {line}
              </Fragment>
            ))}
          </p>
        );
      })}
    </>
  );
}
