import type { ReactNode } from 'react';

export interface PlaceholderProps {
  /** Screen title, rendered as the page heading. */
  title: string;
  children?: ReactNode;
}

/** Temporary screen body used by routes that later tasks will fill in. */
export function Placeholder({ title, children }: PlaceholderProps) {
  return (
    <section className="flex flex-col gap-3 p-4" data-placeholder="">
      <h1 className="text-2xl font-bold">{title}</h1>
      {children}
    </section>
  );
}
