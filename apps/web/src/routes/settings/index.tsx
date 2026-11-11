import { Placeholder } from '@stemdeck/ui';
import { Link } from 'react-router';

export default function Settings() {
  return (
    <Placeholder title="Settings">
      <p className="text-sm opacity-80">Pack import, audio and calibration settings land here.</p>
      <Link to="/" className="underline">
        Back home
      </Link>
    </Placeholder>
  );
}
