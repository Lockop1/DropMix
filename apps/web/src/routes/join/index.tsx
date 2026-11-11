import { Placeholder } from '@stemdeck/ui';
import { Link, useParams } from 'react-router';

export default function Join() {
  const { code = '' } = useParams();
  return (
    <Placeholder title="Join a room">
      <p className="text-sm opacity-80">
        Room code <strong data-testid="room-code">{code.toUpperCase()}</strong>. Joining lands here
        in Phase 3.
      </p>
      <Link to="/" className="underline">
        Back home
      </Link>
    </Placeholder>
  );
}
