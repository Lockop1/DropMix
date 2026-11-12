/**
 * A QR code drawn as an SVG path, generated locally with `qrcode-generator` (MIT). No network
 * call and no innerHTML: the modules are read one by one and turned into a single path.
 */

import qrcode from 'qrcode-generator';
import { useMemo } from 'react';

export function qrPath(text: string): { size: number; d: string } {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  let d = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
    }
  }
  return { size: n, d };
}

export function QrCode({ text, label }: { text: string; label: string }) {
  const { size, d } = useMemo(() => qrPath(text), [text]);
  const quiet = 4;
  const box = size + quiet * 2;
  return (
    <svg
      role="img"
      aria-label={label}
      data-testid="room-qr"
      data-qr-text={text}
      viewBox={`${-quiet} ${-quiet} ${box} ${box}`}
      className="h-auto w-full max-w-56 rounded-lg bg-white"
      shapeRendering="crispEdges"
    >
      <path d={d} fill="#0b0b12" />
    </svg>
  );
}
