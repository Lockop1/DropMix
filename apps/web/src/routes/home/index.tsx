import { Link } from 'react-router';

const LINKS: { to: string; label: string; hint: string }[] = [
  { to: '/solo', label: 'Solo', hint: 'Freestyle on this device' },
  { to: '/puzzle', label: 'Puzzle', hint: 'Solve a mix' },
  { to: '/host', label: 'Host a room', hint: 'This screen is the board' },
  { to: '/join/ABCD', label: 'Join a room', hint: 'Use your phone as a controller' },
  { to: '/play', label: 'Play', hint: 'Controller view' },
  { to: '/settings', label: 'Settings', hint: 'Packs, audio, calibration' },
  { to: '/lab', label: 'Audio lab', hint: 'Phase 0 audio spike' },
  { to: '/roomlab', label: 'Room lab', hint: 'Phase 0 rooms spike' },
  { to: '/packlab', label: 'Pack lab', hint: 'Pack import test page' },
  { to: '/styleguide', label: 'Style guide', hint: 'Design system preview' },
];

export default function Home() {
  return (
    <section className="flex flex-col gap-4 p-4">
      <h1 className="text-3xl font-black tracking-tight">STEMDECK</h1>
      <p className="text-sm opacity-80">Build a mix, one stem at a time.</p>
      <nav aria-label="Screens">
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {LINKS.map((link) => (
            <li key={link.to}>
              <Link
                to={link.to}
                className="flex min-h-12 flex-col justify-center rounded-lg bg-white/10 px-4 py-2 active:bg-white/20"
              >
                <span className="font-semibold">{link.label}</span>
                <span className="text-xs opacity-70">{link.hint}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </section>
  );
}
