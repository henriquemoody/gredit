import { describe, expect, it } from 'bun:test';
import {
  collectTemplateVars,
  parseVarOverrides,
  substituteVars,
  substituteVarsInObject,
  parsePanelSelector,
  buildQueryPayload,
  extractQueryExpression,
} from '../src/validate.ts';
import type { DashboardModel } from '../src/lint.ts';

function makeModel(overrides: Partial<DashboardModel> = {}): DashboardModel {
  return {
    uid: 'test-uid',
    title: 'Test',
    schemaVersion: 38,
    panels: [],
    templating: { list: [] },
    ...overrides,
  };
}

describe('parsePanelSelector', () => {
  it('parses #<id> selectors', () => {
    const result = parsePanelSelector('#42');
    expect(result.type).toBe('id');
    expect(result.value).toBe(42);
    expect(result.raw).toBe('#42');
  });

  it('parses title selectors', () => {
    const result = parsePanelSelector('CPU Usage');
    expect(result.type).toBe('title');
    expect(result.value).toBe('CPU Usage');
    expect(result.raw).toBe('CPU Usage');
  });

  it('treats #abc as a title selector (non-numeric after #)', () => {
    const result = parsePanelSelector('#abc');
    expect(result.type).toBe('title');
    expect(result.value).toBe('#abc');
  });
});

describe('collectTemplateVars', () => {
  it('includes Grafana globals with sensible defaults', () => {
    const vars = collectTemplateVars(makeModel());
    expect(vars.get('__interval')).toBe('1m');
    expect(vars.get('__range')).toBe('15m');
    expect(vars.get('__from')).toBe('now-15m');
  });

  it('extracts variables from templating.list', () => {
    const model = makeModel({
      templating: {
        list: [{ name: 'cluster', current: { value: 'prod' } }],
      },
    });
    const vars = collectTemplateVars(model);
    expect(vars.get('cluster')).toBe('prod');
  });

  it('handles $&#8201;__all&#8201; by converting to .*', () => {
    const model = makeModel({
      templating: {
        list: [{ name: 'env', current: { value: '$__all' } }],
      },
    });
    const vars = collectTemplateVars(model);
    expect(vars.get('env')).toBe('.*');
  });

  it('handles array values by joining with |', () => {
    const model = makeModel({
      templating: {
        list: [{ name: 'env', current: { value: ['prod', 'staging'] } }],
      },
    });
    const vars = collectTemplateVars(model);
    expect(vars.get('env')).toBe('prod|staging');
  });

  it('returns only globals when templating is missing', () => {
    const vars = collectTemplateVars(makeModel({ templating: undefined }));
    expect(vars.size).toBe(
      Object.keys({
        __interval: '1m',
        __interval_ms: '60000',
        __rate_interval: '5m',
        __rate_interval_ms: '300000',
        __range: '15m',
        __range_s: '900',
        __range_ms: '900000',
        __auto_interval: '1m',
        __from: 'now-15m',
        __to: 'now',
      }).length,
    );
  });
});

describe('parseVarOverrides', () => {
  it('parses comma-separated key=value pairs', () => {
    const map = parseVarOverrides(['cluster=prod,env=staging']);
    expect(map.get('cluster')).toBe('prod');
    expect(map.get('env')).toBe('staging');
  });

  it('parses multiple --var entries', () => {
    const map = parseVarOverrides(['cluster=prod', 'env=staging']);
    expect(map.get('cluster')).toBe('prod');
    expect(map.get('env')).toBe('staging');
  });

  it('splits commas within a single --var flag', () => {
    const map = parseVarOverrides(['cluster=prod,env=staging']);
    expect(map.get('cluster')).toBe('prod');
    expect(map.get('env')).toBe('staging');
  });

  it('splits on commas even within a single value (comma in value is not preserved)', () => {
    const map = parseVarOverrides(['labels=a,b']);
    expect(map.get('labels')).toBe('a');
  });

  it('handles values without commas in separate flags', () => {
    const map = parseVarOverrides(['cluster=prod', 'env=staging']);
    expect(map.get('cluster')).toBe('prod');
    expect(map.get('env')).toBe('staging');
  });

  it('returns empty map for undefined input', () => {
    const map = parseVarOverrides(undefined);
    expect(map.size).toBe(0);
  });

  it('skips entries without =', () => {
    const map = parseVarOverrides(['invalid', 'key=value']);
    expect(map.get('key')).toBe('value');
    expect(map.size).toBe(1);
  });
});

describe('substituteVars', () => {
  const vars = new Map([
    ['cluster', 'prod'],
    ['env', 'staging'],
  ]);

  it('substitutes ${var} syntax', () => {
    expect(substituteVars('server-${cluster}-1', vars)).toBe('server-prod-1');
  });

  it('substitutes ${var:format} syntax', () => {
    expect(substituteVars('server-${cluster:percentencode}', vars)).toBe('server-prod');
  });

  it('substitutes [[var]] syntax', () => {
    expect(substituteVars('server-[[cluster]]-1', vars)).toBe('server-prod-1');
  });

  it('substitutes $var syntax', () => {
    expect(substituteVars('$cluster-$env', vars)).toBe('prod-staging');
  });

  it('leaves unknown vars unchanged', () => {
    expect(substituteVars('$unknown_var', vars)).toBe('$unknown_var');
  });
});

describe('substituteVarsInObject', () => {
  it('substitutes vars in string values', () => {
    const vars = new Map([['cluster', 'prod']]);
    expect(substituteVarsInObject({ expr: '$cluster' }, vars)).toEqual({ expr: 'prod' });
  });

  it('recurses into arrays', () => {
    const vars = new Map([['cluster', 'prod']]);
    expect(substituteVarsInObject({ targets: [{ expr: '$cluster' }] }, vars)).toEqual({
      targets: [{ expr: 'prod' }],
    });
  });

  it('preserves non-string values', () => {
    const vars = new Map([['cluster', 'prod']]);
    expect(substituteVarsInObject({ count: 5, flag: true }, vars)).toEqual({
      count: 5,
      flag: true,
    });
  });
});

describe('buildQueryPayload', () => {
  it('returns null for panel with no targets', () => {
    const model = makeModel();
    const vars = new Map<string, string>();
    const result = buildQueryPayload({ id: 1, type: 'text' }, model, vars);
    expect(result).toBeNull();
  });

  it('returns null for panel with empty targets', () => {
    const model = makeModel();
    const vars = new Map<string, string>();
    const result = buildQueryPayload({ id: 1, type: 'stat', targets: [] }, model, vars);
    expect(result).toBeNull();
  });

  it('returns null when all targets are hidden', () => {
    const model = makeModel();
    const vars = new Map<string, string>();
    const result = buildQueryPayload(
      { id: 1, type: 'stat', targets: [{ refId: 'A', hide: true, expr: 'up' }] },
      model,
      vars,
    );
    expect(result).toBeNull();
  });

  it('builds payload with default time range', () => {
    const model = makeModel();
    const vars = new Map<string, string>();
    const result = buildQueryPayload(
      { id: 1, type: 'stat', targets: [{ refId: 'A', expr: 'up' }] },
      model,
      vars,
    );
    expect(result).not.toBeNull();
    expect(result!.from).toBe('now-1h');
    expect(result!.to).toBe('now');
    expect(result!.queries.length).toBe(1);
    expect(result!.queries[0]!.refId).toBe('A');
  });

  it('substitutes vars in query expressions', () => {
    const model = makeModel();
    const vars = new Map([['cluster', 'prod']]);
    const result = buildQueryPayload(
      { id: 1, type: 'stat', targets: [{ refId: 'A', expr: 'up{cluster="$cluster"}' }] },
      model,
      vars,
    );
    expect(result).not.toBeNull();
    expect((result!.queries[0] as Record<string, unknown>)['expr']).toBe('up{cluster="prod"}');
  });

  it('uses custom time range', () => {
    const model = makeModel();
    const vars = new Map<string, string>();
    const result = buildQueryPayload(
      { id: 1, type: 'stat', targets: [{ refId: 'A', expr: 'up' }] },
      model,
      vars,
      'now-6h',
      'now',
    );
    expect(result!.from).toBe('now-6h');
  });
});

describe('extractQueryExpression', () => {
  it('extracts expr field', () => {
    expect(extractQueryExpression({ refId: 'A', expr: 'up' })).toBe('up');
  });

  it('extracts rawSql field', () => {
    expect(extractQueryExpression({ refId: 'A', rawSql: 'SELECT 1' })).toBe('SELECT 1');
  });

  it('extracts query field', () => {
    expect(extractQueryExpression({ refId: 'A', query: 'name:cpu' })).toBe('name:cpu');
  });

  it('falls back to JSON of remaining fields', () => {
    const result = extractQueryExpression({ refId: 'A', someField: 'value' });
    expect(result).toContain('someField');
  });
});
