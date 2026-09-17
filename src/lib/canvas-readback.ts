let cached: boolean | undefined;

export function canvasReadbackUnreliable(): boolean {
  if (cached !== undefined) return cached;
  cached = false;
  try {
    const nav = navigator as Navigator & { resistFingerprinting?: boolean };
    if (nav.resistFingerprinting === true) {
      cached = true;
      return cached;
    }
    const canvas = document.createElement("canvas");
    canvas.width = 2;
    canvas.height = 2;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) {
      cached = true;
      return cached;
    }
    context.fillStyle = "#ff0000";
    context.fillRect(0, 0, 2, 2);
    const { data } = context.getImageData(0, 0, 2, 2);
    canvas.width = canvas.height = 0;
    // A faithful readback is pure opaque red. RFP noise is far outside this
    // tolerance, so a small window absorbs any colour-management rounding.
    const faithful =
      Math.abs(data[0] - 255) <= 8 &&
      Math.abs(data[1] - 0) <= 8 &&
      Math.abs(data[2] - 0) <= 8 &&
      data[3] === 255;
    cached = !faithful;
  } catch {
    cached = true;
  }
  return cached;
}
