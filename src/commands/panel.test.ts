import { describe, expect, it } from 'bun:test';
import { parsePath, getAtPath, setAtPath, parseValue } from './panel.ts';

describe('parsePath', () => {
  it('parses dot-separated paths', () => {
    expect(parsePath('gridPos.h')).toEqual(['gridPos', 'h']);
  });

  it('parses bracket notation', () => {
    expect(parsePath('targets[0].expression')).toEqual(['targets', 0, 'expression']);
  });

  it('parses nested brackets', () => {
    expect(parsePath('targets[0].links[2].url')).toEqual(['targets', 0, 'links', 2, 'url']);
  });

  it('parses single key', () => {
    expect(parsePath('title')).toEqual(['title']);
  });

  it('throws on invalid characters', () => {
    expect(() => parsePath('foo..bar')).toThrow(/Invalid path/);
  });

  it('throws on invalid bracket content', () => {
    expect(() => parsePath('[abc]')).toThrow(/Invalid path/);
  });
});

describe('getAtPath', () => {
  const obj = {
    title: 'CPU',
    gridPos: { x: 0, y: 0, w: 12, h: 8 },
    targets: [{ expr: 'up', refId: 'A' }],
  };

  it('gets top-level value', () => {
    expect(getAtPath(obj, 'title')).toBe('CPU');
  });

  it('gets nested value', () => {
    expect(getAtPath(obj, 'gridPos.h')).toBe(8);
  });

  it('gets array element', () => {
    expect(getAtPath(obj, 'targets[0].expr')).toBe('up');
  });

  it('returns undefined for missing path', () => {
    expect(getAtPath(obj, 'nonexistent')).toBeUndefined();
  });

  it('returns undefined when traversing through null', () => {
    expect(getAtPath({ a: null }, 'a.b')).toBeUndefined();
  });
});

describe('setAtPath', () => {
  it('sets top-level value', () => {
    const obj: Record<string, unknown> = { title: 'old' };
    setAtPath(obj, 'title', 'new');
    expect(obj.title).toBe('new');
  });

  it('sets nested value', () => {
    const obj = { gridPos: { h: 8 } };
    setAtPath(obj, 'gridPos.h', 12);
    expect((obj as Record<string, unknown>).gridPos as Record<string, unknown>).toHaveProperty(
      'h',
      12,
    );
  });

  it('sets array element', () => {
    const obj = { targets: [{ expr: 'old' }] };
    setAtPath(obj, 'targets[0].expr', 'new');
    expect(
      ((obj as Record<string, unknown>).targets as Record<string, unknown>[])[0],
    ).toHaveProperty('expr', 'new');
  });

  it('throws on non-object parent', () => {
    expect(() => setAtPath({ a: 5 }, 'a.b', 10)).toThrow(/not an object/);
  });

  it('throws on invalid path', () => {
    expect(() => setAtPath({}, 'foo..bar', 5)).toThrow(/Invalid path/);
  });
});

describe('parseValue', () => {
  it('parses valid JSON string', () => {
    expect(parseValue('"hello"')).toBe('hello');
  });

  it('parses valid JSON number', () => {
    expect(parseValue('42')).toBe(42);
  });

  it('parses valid JSON boolean', () => {
    expect(parseValue('true')).toBe(true);
  });

  it('parses valid JSON object', () => {
    expect(parseValue('{"key": "value"}')).toEqual({ key: 'value' });
  });

  it('returns raw string for non-JSON values', () => {
    expect(parseValue('just a string')).toBe('just a string');
  });
});
