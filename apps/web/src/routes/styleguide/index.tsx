import { Placeholder } from '@stemdeck/ui';
import { Link } from 'react-router';

export default function StyleGuide() {
  return (
    <Placeholder title="Style guide">
      <p className="text-sm opacity-80">The design system preview lands here.</p>
      <Link to="/" className="underline">
        Back home
      </Link>
    </Placeholder>
  );
}
