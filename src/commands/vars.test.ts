import { describe, expect, it } from 'bun:test';
import { listVars } from './vars.ts';
import type { DashboardModel } from '../lint.ts';

describe('listVars', () => {
  it('returns empty array for model with no templating block', () => {
    const model: DashboardModel = { title: 'Test' };
    const result = listVars(model);
    expect(result).toEqual([]);
  });

  it('returns empty array for model with empty templating.list', () => {
    const model: DashboardModel = {
      title: 'Test',
      templating: { list: [] },
    };
    const result = listVars(model);
    expect(result).toEqual([]);
  });

  it('extracts basic template variable fields', () => {
    const model: DashboardModel = {
      title: 'Test',
      templating: {
        list: [
          {
            name: 'cluster',
            type: 'query',
            current: { value: 'prod' },
            options: [{ value: 'prod', text: 'Production' }],
          },
        ],
      },
    };
    const result = listVars(model);
    expect(result).toEqual([
      {
        name: 'cluster',
        type: 'query',
        current: 'prod',
        optionsCount: 1,
      },
    ]);
  });

  it('handles array current.value by joining with comma', () => {
    const model: DashboardModel = {
      title: 'Test',
      templating: {
        list: [
          {
            name: 'env',
            type: 'custom',
            current: { value: ['staging', 'prod'] },
            options: [],
          },
        ],
      },
    };
    const result = listVars(model);
    expect(result).toEqual([
      {
        name: 'env',
        type: 'custom',
        current: 'staging,prod',
        optionsCount: 0,
      },
    ]);
  });

  it('converts $__all current value to .*', () => {
    const model: DashboardModel = {
      title: 'Test',
      templating: {
        list: [
          {
            name: 'region',
            type: 'query',
            current: { value: '$__all' },
            options: [],
          },
        ],
      },
    };
    const result = listVars(model);
    expect(result).toEqual([
      {
        name: 'region',
        type: 'query',
        current: '.*',
        optionsCount: 0,
      },
    ]);
  });

  it('handles null type', () => {
    const model: DashboardModel = {
      title: 'Test',
      templating: {
        list: [
          {
            name: 'custom_var',
            type: null,
            current: { value: 'test' },
            options: [],
          },
        ],
      },
    };
    const result = listVars(model);
    expect(result).toEqual([
      {
        name: 'custom_var',
        type: null,
        current: 'test',
        optionsCount: 0,
      },
    ]);
  });

  it('skips variables without valid name', () => {
    const model: DashboardModel = {
      title: 'Test',
      templating: {
        list: [
          {
            type: 'query',
            current: { value: 'prod' },
            options: [],
          },
          {
            name: 'valid_var',
            type: 'custom',
            current: { value: 'test' },
            options: [],
          },
        ],
      },
    };
    const result = listVars(model);
    expect(result).toEqual([
      {
        name: 'valid_var',
        type: 'custom',
        current: 'test',
        optionsCount: 0,
      },
    ]);
  });

  it('counts options correctly', () => {
    const model: DashboardModel = {
      title: 'Test',
      templating: {
        list: [
          {
            name: 'cluster',
            type: 'query',
            current: { value: 'prod' },
            options: [
              { value: 'dev', text: 'Development' },
              { value: 'staging', text: 'Staging' },
              { value: 'prod', text: 'Production' },
            ],
          },
        ],
      },
    };
    const result = listVars(model);
    expect(result).toEqual([
      {
        name: 'cluster',
        type: 'query',
        current: 'prod',
        optionsCount: 3,
      },
    ]);
  });

  it('handles numeric current values', () => {
    const model: DashboardModel = {
      title: 'Test',
      templating: {
        list: [
          {
            name: 'threshold',
            type: 'custom',
            current: { value: 42 },
            options: [],
          },
        ],
      },
    };
    const result = listVars(model);
    expect(result).toEqual([
      {
        name: 'threshold',
        type: 'custom',
        current: '42',
        optionsCount: 0,
      },
    ]);
  });

  it('handles variables with missing current field', () => {
    const model: DashboardModel = {
      title: 'Test',
      templating: {
        list: [
          {
            name: 'optional_var',
            type: 'custom',
            options: [],
          },
        ],
      },
    };
    const result = listVars(model);
    expect(result).toEqual([
      {
        name: 'optional_var',
        type: 'custom',
        current: null,
        optionsCount: 0,
      },
    ]);
  });

  it('skips non-object items in templating.list', () => {
    const model: DashboardModel = {
      title: 'Test',
      templating: {
        list: [
          'invalid-string',
          42,
          null,
          {
            name: 'valid_var',
            type: 'custom',
            current: { value: 'test' },
            options: [],
          },
        ],
      },
    };
    const result = listVars(model);
    expect(result).toEqual([
      {
        name: 'valid_var',
        type: 'custom',
        current: 'test',
        optionsCount: 0,
      },
    ]);
  });
});
