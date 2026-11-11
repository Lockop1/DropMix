import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Placeholder } from '../src';

describe('Placeholder', () => {
  it('renders its title as a heading and its children', () => {
    const html = renderToStaticMarkup(
      <Placeholder title="Solo">
        <p>Coming soon</p>
      </Placeholder>,
    );
    expect(html).toContain('<h1 class="text-2xl font-bold">Solo</h1>');
    expect(html).toContain('<p>Coming soon</p>');
  });
});
