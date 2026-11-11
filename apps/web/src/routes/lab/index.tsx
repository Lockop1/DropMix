import { Placeholder } from '@stemdeck/ui';
import { Link } from 'react-router';

export default function Lab() {
  return (
    <Placeholder title="Audio lab">
      <p className="text-sm opacity-80">
        The audio spike (task 0B) lands here. Add nested routes inside src/routes/lab/.
      </p>
      <Link to="/" className="underline">
        Back home
      </Link>
    </Placeholder>
  );
}
