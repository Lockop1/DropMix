import { Placeholder } from '@stemdeck/ui';
import { Link } from 'react-router';

export default function Solo() {
  return (
    <Placeholder title="Solo">
      <p className="text-sm opacity-80">Solo Freestyle lands here in Phase 1.</p>
      <Link to="/" className="underline">
        Back home
      </Link>
    </Placeholder>
  );
}
