import { Placeholder } from '@stemdeck/ui';
import { Link } from 'react-router';

export default function RoomLab() {
  return (
    <Placeholder title="Room lab">
      <p className="text-sm opacity-80">
        The rooms spike (task 0D) lands here. Add nested routes inside src/routes/roomlab/.
      </p>
      <Link to="/" className="underline">
        Back home
      </Link>
    </Placeholder>
  );
}
