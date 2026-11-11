import { Placeholder } from '@stemdeck/ui';
import { Link } from 'react-router';

export default function Puzzle() {
  return (
    <Placeholder title="Puzzle">
      <p className="text-sm opacity-80">Puzzle mode lands here in Phase 4.</p>
      <Link to="/" className="underline">
        Back home
      </Link>
    </Placeholder>
  );
}
