import { Placeholder } from '@stemdeck/ui';
import { Link } from 'react-router';

export default function PackLab() {
  return (
    <Placeholder title="Pack lab">
      <p className="text-sm opacity-80">The pack import test page lands here (task 1D).</p>
      <Link to="/" className="underline">
        Back home
      </Link>
    </Placeholder>
  );
}
