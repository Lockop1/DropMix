import { describe, expect, it } from 'vitest';
import { routes } from '../src/router';

describe('router', () => {
  const [root] = routes;
  const children = root?.children ?? [];

  it('mounts every screen under the root layout', () => {
    expect(root?.path).toBe('/');
    expect(children.map((r) => (r.index ? '(index)' : r.path))).toEqual([
      '(index)',
      'solo',
      'puzzle',
      'host',
      'join/:code',
      'play',
      'settings',
      'lab/*',
      'roomlab/*',
      'packlab/*',
      'styleguide/*',
    ]);
  });

  it('code-splits every screen', () => {
    for (const route of children) expect(typeof route.lazy).toBe('function');
  });
});
