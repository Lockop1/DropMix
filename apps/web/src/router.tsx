import type { ComponentType } from 'react';
import { createBrowserRouter, type RouteObject } from 'react-router';
import { RootLayout, RouteLoading } from './RootLayout';

type RouteModule = { default: ComponentType };

/**
 * A route whose component is code-split. Each route lives in its own directory under
 * src/routes/<name>/ and default-exports its component, so a task can own a route directory
 * without touching this file.
 */
function lazyRoute(path: string, load: () => Promise<RouteModule>): RouteObject {
  return {
    path,
    lazy: async () => ({ Component: (await load()).default }),
  };
}

/** Every top-level screen. `/lab/*`, `/roomlab/*`, `/packlab/*` and `/styleguide/*` are splats: nested routes live in their directory. */
export const routes: RouteObject[] = [
  {
    path: '/',
    Component: RootLayout,
    HydrateFallback: RouteLoading,
    children: [
      { index: true, lazy: async () => ({ Component: (await import('./routes/home')).default }) },
      lazyRoute('solo', () => import('./routes/solo')),
      lazyRoute('puzzle', () => import('./routes/puzzle')),
      lazyRoute('host', () => import('./routes/host')),
      lazyRoute('join/:code', () => import('./routes/join')),
      lazyRoute('play', () => import('./routes/play')),
      lazyRoute('settings', () => import('./routes/settings')),
      lazyRoute('lab/*', () => import('./routes/lab')),
      lazyRoute('roomlab/*', () => import('./routes/roomlab')),
      lazyRoute('packlab/*', () => import('./routes/packlab')),
      lazyRoute('styleguide/*', () => import('./routes/styleguide')),
    ],
  },
];

export function createAppRouter() {
  return createBrowserRouter(routes);
}
