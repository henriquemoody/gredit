import { describe, expect, it } from 'bun:test';
import { listPanels } from './panels.ts';

describe('listPanels', () => {
  it('returns empty array for empty panels', () => {
    const model = { panels: [] };
    const result = listPanels(model);
    expect(result).toEqual([]);
  });

  it('handles flat panels with all fields present', () => {
    const model = {
      panels: [
        {
          id: 1,
          title: 'CPU Usage',
          type: 'stat',
          gridPos: { x: 0, y: 0, w: 12, h: 8 },
        },
        {
          id: 2,
          title: 'Memory Usage',
          type: 'graph',
          gridPos: { x: 12, y: 0, w: 12, h: 8 },
        },
      ],
    };
    const result = listPanels(model);
    expect(result).toEqual([
      {
        id: 1,
        title: 'CPU Usage',
        type: 'stat',
        x: 0,
        y: 0,
        w: 12,
        h: 8,
      },
      {
        id: 2,
        title: 'Memory Usage',
        type: 'graph',
        x: 12,
        y: 0,
        w: 12,
        h: 8,
      },
    ]);
  });

  it('handles nested row panels', () => {
    const model = {
      panels: [
        {
          id: 1,
          title: 'Row 1',
          type: 'row',
          gridPos: { x: 0, y: 0, w: 24, h: 1 },
          panels: [
            {
              id: 2,
              title: 'Nested Panel',
              type: 'stat',
              gridPos: { x: 0, y: 1, w: 12, h: 8 },
            },
          ],
        },
        {
          id: 3,
          title: 'Standalone Panel',
          type: 'graph',
          gridPos: { x: 0, y: 10, w: 24, h: 12 },
        },
      ],
    };
    const result = listPanels(model);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({
      id: 1,
      title: 'Row 1',
      type: 'row',
      x: 0,
      y: 0,
      w: 24,
      h: 1,
    });
    expect(result[1]).toEqual({
      id: 2,
      title: 'Nested Panel',
      type: 'stat',
      x: 0,
      y: 1,
      w: 12,
      h: 8,
    });
    expect(result[2]).toEqual({
      id: 3,
      title: 'Standalone Panel',
      type: 'graph',
      x: 0,
      y: 10,
      w: 24,
      h: 12,
    });
  });

  it('handles missing gridPos with null values', () => {
    const model = {
      panels: [
        {
          id: 1,
          title: 'Panel without gridPos',
          type: 'text',
        },
      ],
    };
    const result = listPanels(model);
    expect(result).toEqual([
      {
        id: 1,
        title: 'Panel without gridPos',
        type: 'text',
        x: null,
        y: null,
        w: null,
        h: null,
      },
    ]);
  });

  it('handles missing id with null value', () => {
    const model = {
      panels: [
        {
          title: 'Panel without id',
          type: 'stat',
          gridPos: { x: 0, y: 0, w: 12, h: 8 },
        },
      ],
    };
    const result = listPanels(model);
    expect(result).toEqual([
      {
        id: null,
        title: 'Panel without id',
        type: 'stat',
        x: 0,
        y: 0,
        w: 12,
        h: 8,
      },
    ]);
  });

  it('handles missing title with null value', () => {
    const model = {
      panels: [
        {
          id: 1,
          type: 'stat',
          gridPos: { x: 0, y: 0, w: 12, h: 8 },
        },
      ],
    };
    const result = listPanels(model);
    expect(result).toEqual([
      {
        id: 1,
        title: null,
        type: 'stat',
        x: 0,
        y: 0,
        w: 12,
        h: 8,
      },
    ]);
  });

  it('handles missing type with null value', () => {
    const model = {
      panels: [
        {
          id: 1,
          title: 'Panel without type',
          gridPos: { x: 0, y: 0, w: 12, h: 8 },
        },
      ],
    };
    const result = listPanels(model);
    expect(result).toEqual([
      {
        id: 1,
        title: 'Panel without type',
        type: null,
        x: 0,
        y: 0,
        w: 12,
        h: 8,
      },
    ]);
  });

  it('handles undefined panels array', () => {
    const model = {};
    const result = listPanels(model);
    expect(result).toEqual([]);
  });
});
