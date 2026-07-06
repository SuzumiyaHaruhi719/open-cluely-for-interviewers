import '@testing-library/jest-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PipelineStudio } from './PipelineStudio';
import type { BlockTypeMeta, Pipeline } from '../../lib/api';

// --- Fixtures the mock fetch serves ----------------------------------------

const BLOCK_TYPES: BlockTypeMeta[] = [
  {
    id: 'anatomy',
    label: '拆解回答',
    schemaId: 'A',
    inputs: [],
    outputType: 'claims',
    defaultBody: 'default A body',
    defaults: { model: 'deepseek-v4-flash', thinking: { type: 'disabled' }, temperature: 0.1, maxTokens: 1200 }
  },
  {
    id: 'evidence-gap',
    label: '查找证据缺口',
    schemaId: 'B',
    inputs: [{ name: 'claims', type: 'claims', optional: false }],
    outputType: 'gaps',
    defaultBody: 'default B body',
    defaults: { model: 'deepseek-v4-flash', thinking: { type: 'disabled' }, temperature: 0.2, maxTokens: 1200 }
  },
  {
    id: 'final-render',
    label: '整理成稿',
    schemaId: 'G',
    inputs: [{ name: 'gaps', type: 'gaps', optional: false }],
    outputType: 'final',
    defaultBody: 'default G body',
    defaults: { model: 'deepseek-v4-pro', thinking: { type: 'disabled' }, temperature: 0.3, maxTokens: 1600 }
  }
];

const EXPERT: Pipeline = {
  id: 'builtin-expert',
  name: 'Expert 1.0',
  builtin: true,
  version: 'expert_v1',
  nodes: [
    { id: 'A', type: 'anatomy', pos: { x: 40, y: 40 } },
    { id: 'B', type: 'evidence-gap', pos: { x: 240, y: 40 } },
    { id: 'G', type: 'final-render', pos: { x: 440, y: 40 } }
  ],
  edges: [
    { fromNode: 'A', fromPort: 'out', toNode: 'B', toPort: 'claims' },
    { fromNode: 'B', fromPort: 'out', toNode: 'G', toPort: 'gaps' }
  ]
};

interface FetchCall {
  url: string;
  method: string;
  body: unknown;
}

let fetchCalls: FetchCall[];

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: () => Promise.resolve(body) } as Response;
}

beforeEach(() => {
  fetchCalls = [];
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    fetchCalls.push({ url, method, body });

    if (url.endsWith('/api/pipelines/block-types')) {
      return Promise.resolve(jsonResponse({ blockTypes: BLOCK_TYPES }));
    }
    if (url.endsWith('/api/pipelines/validate') && method === 'POST') {
      return Promise.resolve(jsonResponse({ ok: true, errors: [] }));
    }
    if (url.endsWith('/api/pipelines') && method === 'POST') {
      return Promise.resolve(jsonResponse({ id: body?.pipeline?.id ?? 'saved-1' }));
    }
    if (url.endsWith('/api/pipelines') && method === 'GET') {
      return Promise.resolve(
        jsonResponse({
          pipelines: [
            { id: 'builtin-expert', name: 'Expert 1.0', builtin: true },
            { id: 'my-custom', name: 'My Custom', builtin: false }
          ]
        })
      );
    }
    if (url.includes('/api/pipelines/builtin-expert')) {
      return Promise.resolve(jsonResponse({ pipeline: EXPERT }));
    }
    return Promise.reject(new Error(`unexpected url ${url}`));
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Wait until the Expert clone has populated the canvas. */
async function waitForCanvas(): Promise<void> {
  await waitFor(() => {
    expect(document.querySelectorAll('.ps-node').length).toBeGreaterThan(0);
  });
}

describe('PipelineStudio', () => {
  test('hidden when closed; no fetch fired', () => {
    render(<PipelineStudio open={false} onClose={() => {}} onUse={() => {}} />);
    const root = document.getElementById('pipeline-studio');
    expect(root?.classList.contains('hidden')).toBe(true);
    expect(fetchCalls).toHaveLength(0);
  });

  test('opens with the desktop .ps-* structure and seeds the Expert clone', async () => {
    render(<PipelineStudio open onClose={() => {}} onUse={() => {}} />);

    // Markup parity with the desktop #pipeline-studio.
    expect(document.getElementById('pipeline-studio')).toBeInTheDocument();
    expect(document.querySelector('.ps-topbar')).toBeInTheDocument();
    expect(document.querySelector('.ps-body > .ps-palette')).toBeInTheDocument();
    expect(document.querySelector('.ps-canvas-wrap > .ps-canvas > svg.ps-wires')).toBeInTheDocument();
    expect(document.querySelector('.ps-body > .ps-config')).toBeInTheDocument();
    expect(document.getElementById('ps-status')).toBeInTheDocument();

    // Palette renders one button per block type.
    await waitFor(() => {
      expect(document.querySelectorAll('.ps-palette__item').length).toBe(BLOCK_TYPES.length);
    });

    // The canvas seeds the 3 cloned Expert nodes + the 2 wires.
    await waitForCanvas();
    expect(document.querySelectorAll('.ps-node').length).toBe(3);
    await waitFor(() => {
      expect(document.querySelectorAll('.ps-wire').length).toBe(2);
    });

    // A fresh clone is named "我的流程" (matches the desktop New-clone flow),
    // and the catalog + library were fetched.
    expect((document.getElementById('ps-name') as HTMLInputElement).value).toBe('我的流程');
    expect(fetchCalls.some((c) => c.url.endsWith('/api/pipelines/block-types'))).toBe(true);
    expect(fetchCalls.some((c) => c.url.endsWith('/api/pipelines') && c.method === 'GET')).toBe(true);
  });

  test('renders Studio chrome in Chinese', async () => {
    render(<PipelineStudio open onClose={() => {}} onUse={() => {}} />);
    await waitForCanvas();

    expect(screen.getByText('流程工作台')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /\+ 新建（克隆 Expert）/ })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('流程名称')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '校验' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '启用' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '导出' })).toBeInTheDocument();
    expect(screen.getByText('模块')).toBeInTheDocument();
  });

  test('clicking a palette block adds a node and selects it for config', async () => {
    render(<PipelineStudio open onClose={() => {}} onUse={() => {}} />);
    await waitForCanvas();
    expect(document.querySelectorAll('.ps-node').length).toBe(3);

    fireEvent.click(screen.getByRole('button', { name: /拆解回答/ }));

    await waitFor(() => {
      expect(document.querySelectorAll('.ps-node').length).toBe(4);
    });
    // The config panel now shows the selected (new) anatomy block's fields.
    expect(document.getElementById('ps-f-model')).toBeInTheDocument();
    expect(document.getElementById('ps-f-body')).toBeInTheDocument();
  });

  test('Validate posts the pipeline and shows VALID in the status bar', async () => {
    render(<PipelineStudio open onClose={() => {}} onUse={() => {}} />);
    await waitForCanvas();

    fireEvent.click(screen.getByRole('button', { name: '校验' }));

    await waitFor(() => {
      expect(document.getElementById('ps-status')?.textContent).toMatch(/校验通过/);
    });
    const validateCall = fetchCalls.find((c) => c.url.endsWith('/api/pipelines/validate'));
    expect(validateCall?.method).toBe('POST');
  });

  test('"Use this" validates, saves, then activates via onUse and closes', async () => {
    const onUse = vi.fn();
    const onClose = vi.fn();
    render(<PipelineStudio open onClose={onClose} onUse={onUse} />);
    await waitForCanvas();

    // Name it so the save id is a deterministic slug.
    fireEvent.change(document.getElementById('ps-name') as HTMLInputElement, {
      target: { value: 'Senior Backend' }
    });

    fireEvent.click(screen.getByRole('button', { name: '启用' }));

    await waitFor(() => {
      expect(onUse).toHaveBeenCalledTimes(1);
    });
    // Saved under the slug, then activated with that id; studio closes.
    const saveCall = fetchCalls.find((c) => c.url.endsWith('/api/pipelines') && c.method === 'POST');
    expect((saveCall?.body as { pipeline: Pipeline }).pipeline.id).toBe('senior-backend');
    expect(onUse).toHaveBeenCalledWith('senior-backend', 'Senior Backend');
    expect(onClose).toHaveBeenCalled();
  });

  test('selecting a library entry loads that pipeline', async () => {
    render(<PipelineStudio open onClose={() => {}} onUse={() => {}} />);
    await waitForCanvas();

    // Open the library menu and pick the built-in Expert entry.
    fireEvent.click(screen.getByRole('button', { name: /\+ 新建（克隆 Expert）/ }));
    fireEvent.click(screen.getByRole('option', { name: /Expert 1\.0/ }));

    await waitFor(() => {
      expect(fetchCalls.filter((c) => c.url.includes('/api/pipelines/builtin-expert')).length).toBeGreaterThanOrEqual(2);
    });
    // Loading a built-in surfaces the editable-copy hint.
    await waitFor(() => {
      expect(document.getElementById('ps-status')?.textContent).toMatch(/内置预设/);
    });
  });
});
