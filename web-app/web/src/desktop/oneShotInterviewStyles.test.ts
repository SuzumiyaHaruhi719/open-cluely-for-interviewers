import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/desktop-ui/one-shot-interview.css'), 'utf8');

describe('one-shot interview layout contracts', () => {
  test('gives automatic context its own keyboard-scrollable viewport', () => {
    const bodyRule = css.match(/\.context-drawer__body\s*\{(?<body>[\s\S]*?)\}/)?.groups?.body ?? '';
    expect(bodyRule).toMatch(/min-height:\s*0/);
    expect(bodyRule).toMatch(/overflow-y:\s*auto/);
    expect(bodyRule).toMatch(/overscroll-behavior:\s*contain/);
    expect(bodyRule).toMatch(/scrollbar-gutter:\s*stable/);
  });

  test('uses the same source field geometry for both audio lanes', () => {
    expect(css).toMatch(/\.interview-dock\s+\[data-source-field='true'\]/);
    const sourceRule = css.match(
      /\.interview-dock\s+\[data-source-field='true'\]\s*\{(?<body>[\s\S]*?)\}/
    )?.groups?.body ?? '';
    expect(sourceRule).toMatch(/height:\s*29px/);
  });

  test('constrains the transcript to a visible independently scrollable viewport', () => {
    const workspaceRule = css.match(
      /\.interview-workspace\s*\{(?<body>[\s\S]*?)\}/
    )?.groups?.body ?? '';
    const stageRules = Array.from(css.matchAll(/\.interview-stage\s*\{(?<body>[\s\S]*?)\}/g));
    const stageRule = stageRules.at(-1)?.groups?.body ?? '';
    const messagesRule = css.match(
      /\.one-shot-app \.chat-messages\s*\{(?<body>[\s\S]*?)\}/
    )?.groups?.body ?? '';

    expect(workspaceRule).toMatch(/display:\s*grid/);
    expect(workspaceRule).toMatch(/grid-template-rows:\s*minmax\(0,\s*1fr\)/);
    expect(stageRule).toMatch(/height:\s*100%/);
    expect(messagesRule).toMatch(/overflow-y:\s*auto/);
    expect(messagesRule).toMatch(/overscroll-behavior-y:\s*contain/);
    expect(messagesRule).toMatch(/scrollbar-gutter:\s*stable/);
    expect(messagesRule).toMatch(/scrollbar-width:\s*thin/);
    expect(messagesRule).toMatch(/touch-action:\s*pan-y/);
  });
});
