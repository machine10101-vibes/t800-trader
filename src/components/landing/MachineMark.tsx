/** Photoreal chrome endoskeleton. Faces the camera while the coin ring orbits. */
export function MachineMark() {
  return (
    <div className="machine" aria-hidden>
      {/* Local cutout shipped in /public. next/image cannot frame this plane. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        className="machine-photo"
        src="/t800-trader/landing/endoskeleton.png"
        alt=""
        width={597}
        height={934}
        draggable={false}
      />
    </div>
  );
}
