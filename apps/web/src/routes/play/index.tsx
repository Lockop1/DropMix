import { Placeholder } from '@stemdeck/ui';
import { Link } from 'react-router';

export default function Play() {
  return (
    <Placeholder title="Play">
      <p className="text-sm opacity-80">The phone controller lands here in Phase 3.</p>
      <Link to="/" className="underline">
        Back home
      </Link>
    </Placeholder>
  );
}
