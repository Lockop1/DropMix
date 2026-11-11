import { Outlet } from 'react-router';

/** Shell for every screen: full dynamic-viewport height, safe-area padding, no overscroll. */
export function RootLayout() {
  return (
    <div className="app-shell">
      <main className="flex min-w-0 flex-1 flex-col">
        <Outlet />
      </main>
    </div>
  );
}

/** Shown while the first lazy route module loads. */
export function RouteLoading() {
  return (
    <div className="app-shell items-center justify-center">
      <p className="text-sm opacity-70">Loading…</p>
    </div>
  );
}
