import { describe, expect, it } from 'bun:test';
import { lintDashboard, collectPanels, type DashboardModel, type Panel } from '../src/lint.ts';

function makeModel(overrides: Partial<DashboardModel> = {}): DashboardModel {
  return {
    uid: 'test-uid',
    title: 'Test Dashboard',
    schemaVersion: 38,
    panels: [
      {
        id: 1,
        type: 'stat',
        title: 'CPU',
        gridPos: { x: 0, y: 0, w: 12, h: 8 },
        ...overrides,
      },
    ],
    templating: { list: [] },
    ...overrides,
  };
}

describe('collectPanels', () => {
  it('returns flat list including nested panels', () => {
    const panels: Panel[] = [
      { id: 1, type: 'row', title: 'Row', gridPos: { x: 0, y: 0, w: 24, h: 1 } },
      {
        id: 2,
        type: 'stat',
        title: 'Nested',
        gridPos: { x: 0, y: 1, w: 12, h: 8 },
        panels: [{ id: 3, type: 'text', title: 'Deep', gridPos: { x: 0, y: 0, w: 6, h: 4 } }],
      },
    ];
    const result = collectPanels(panels);
    expect(result.length).toBe(3);
    expect(result.map((p) => p.id)).toEqual([1, 2, 3]);
  });

  it('returns empty array for undefined panels', () => {
    expect(collectPanels(undefined)).toEqual([]);
  });
});

describe('lintDashboard', () => {
  it('reports no issues for a valid dashboard', () => {
    const issues = lintDashboard(makeModel());
    expect(issues.length).toBe(0);
  });

  it('reports error for missing uid', () => {
    const issues = lintDashboard(makeModel({ uid: undefined }));
    expect(issues.some((i) => i.level === 'error' && i.message.includes('uid'))).toBe(true);
  });

  it('reports error for empty uid', () => {
    const issues = lintDashboard(makeModel({ uid: '' }));
    expect(issues.some((i) => i.level === 'error' && i.message.includes('uid'))).toBe(true);
  });

  it('reports error for missing title', () => {
    const issues = lintDashboard(makeModel({ title: undefined }));
    expect(issues.some((i) => i.level === 'error' && i.message.includes('title'))).toBe(true);
  });

  it('reports warning for missing schemaVersion', () => {
    const issues = lintDashboard(makeModel({ schemaVersion: undefined }));
    expect(issues.some((i) => i.level === 'warning' && i.message.includes('schemaVersion'))).toBe(
      true,
    );
  });

  it('reports warning for missing templating.list', () => {
    const issues = lintDashboard(makeModel({ templating: undefined }));
    expect(issues.some((i) => i.level === 'warning' && i.message.includes('templating'))).toBe(
      true,
    );
  });

  it('reports warning for empty panels', () => {
    const issues = lintDashboard(makeModel({ panels: [] }));
    expect(issues.some((i) => i.level === 'warning' && i.message.includes('no panels'))).toBe(true);
  });

  it('reports error for duplicate panel ids', () => {
    const model = makeModel({
      panels: [
        { id: 1, type: 'stat', title: 'A', gridPos: { x: 0, y: 0, w: 12, h: 8 } },
        { id: 1, type: 'stat', title: 'B', gridPos: { x: 12, y: 0, w: 12, h: 8 } },
      ],
    });
    const issues = lintDashboard(model);
    expect(
      issues.some((i) => i.level === 'error' && i.message.includes('duplicate panel id')),
    ).toBe(true);
  });

  it('reports error for panel missing id', () => {
    const model = makeModel({
      panels: [{ type: 'stat', title: 'NoId', gridPos: { x: 0, y: 0, w: 12, h: 8 } }],
    });
    const issues = lintDashboard(model);
    expect(issues.some((i) => i.level === 'error' && i.message.includes('numeric'))).toBe(true);
  });

  it('reports error for panel missing type', () => {
    const model = makeModel({
      panels: [{ id: 1, title: 'NoType', gridPos: { x: 0, y: 0, w: 12, h: 8 } }],
    });
    const issues = lintDashboard(model);
    expect(issues.some((i) => i.level === 'error' && i.message.includes('type'))).toBe(true);
  });

  it('reports error for invalid or missing gridPos', () => {
    const model = makeModel({
      panels: [{ id: 1, type: 'stat', title: 'BadGrid' }],
    });
    const issues = lintDashboard(model);
    expect(issues.some((i) => i.level === 'error' && i.message.includes('gridPos'))).toBe(true);
  });

  it('accepts null uid as missing', () => {
    const issues = lintDashboard(makeModel({ uid: null as unknown as string | undefined }));
    expect(issues.some((i) => i.level === 'error' && i.message.includes('uid'))).toBe(true);
  });
});
