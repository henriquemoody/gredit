import { describe, expect, it } from 'bun:test';
import { dashboardInfo } from './info.ts';
import type { DashboardModel } from '../lint.ts';

describe('dashboardInfo', () => {
  it('returns full metadata for a complete model', () => {
    const model: DashboardModel = {
      uid: 'abc123',
      title: 'My Dashboard',
      schemaVersion: 38,
      panels: [
        { id: 1, type: 'stat', title: 'CPU', gridPos: { x: 0, y: 0, w: 12, h: 8 } },
        { id: 5, type: 'graph', title: 'Memory', gridPos: { x: 12, y: 0, w: 12, h: 8 } },
      ],
      templating: {
        list: [
          { name: 'cluster', type: 'query', current: { value: 'prod' } },
          { name: 'env', type: 'custom', current: { value: 'staging' } },
        ],
      },
    };
    const result = dashboardInfo(model);
    expect(result).toEqual({
      uid: 'abc123',
      title: 'My Dashboard',
      schemaVersion: 38,
      panelCount: 2,
      maxPanelId: 5,
      templatingCount: 2,
    });
  });

  it('returns nulls for missing uid and title', () => {
    const model: DashboardModel = {};
    const result = dashboardInfo(model);
    expect(result.uid).toBeNull();
    expect(result.title).toBeNull();
  });

  it('returns null schemaVersion when missing', () => {
    const model: DashboardModel = {};
    const result = dashboardInfo(model);
    expect(result.schemaVersion).toBeNull();
  });

  it('returns panelCount 0 and maxPanelId null with no panels', () => {
    const model: DashboardModel = { panels: [] };
    const result = dashboardInfo(model);
    expect(result.panelCount).toBe(0);
    expect(result.maxPanelId).toBeNull();
  });

  it('returns panelCount 0 and maxPanelId null with undefined panels', () => {
    const model: DashboardModel = {};
    const result = dashboardInfo(model);
    expect(result.panelCount).toBe(0);
    expect(result.maxPanelId).toBeNull();
  });

  it('returns maxPanelId null when panels have no numeric ids', () => {
    const model: DashboardModel = {
      panels: [{ title: 'No ID', type: 'text', gridPos: { x: 0, y: 0, w: 12, h: 8 } }],
    };
    const result = dashboardInfo(model);
    expect(result.maxPanelId).toBeNull();
  });

  it('includes nested row panels in panelCount', () => {
    const model: DashboardModel = {
      panels: [
        {
          id: 1,
          type: 'row',
          title: 'Row',
          gridPos: { x: 0, y: 0, w: 24, h: 1 },
          panels: [{ id: 2, type: 'stat', title: 'Nested', gridPos: { x: 0, y: 1, w: 12, h: 8 } }],
        },
      ],
    };
    const result = dashboardInfo(model);
    expect(result.panelCount).toBe(2);
    expect(result.maxPanelId).toBe(2);
  });

  it('returns templatingCount 0 when no templating block', () => {
    const model: DashboardModel = {};
    const result = dashboardInfo(model);
    expect(result.templatingCount).toBe(0);
  });

  it('returns templatingCount 0 when templating has empty list', () => {
    const model: DashboardModel = { templating: { list: [] } };
    const result = dashboardInfo(model);
    expect(result.templatingCount).toBe(0);
  });
});
