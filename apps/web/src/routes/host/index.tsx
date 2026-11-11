import { Placeholder } from '@stemdeck/ui';
import { Link } from 'react-router';

export default function Host() {
  return (
    <Placeholder title="Host a room">
      <p className="text-sm opacity-80">The host board lands here in Phase 3.</p>
      <Link to="/" className="underline">
        Back home
      </Link>
    </Placeholder>
  );
}
