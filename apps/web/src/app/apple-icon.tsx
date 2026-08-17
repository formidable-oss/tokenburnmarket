import { ImageResponse } from "next/og";

/* 180x180 touch icon: the mark on the canvas color, generous padding, no frame corners at this size. */
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

const BARS = [3, 5, 9, 6, 4];

export default function AppleIcon() {
  const cell = 12;
  const offsetX = (180 - 5 * cell) / 2;
  const offsetY = (180 - 9 * cell) / 2;
  const cells: React.ReactNode[] = [];
  BARS.forEach((h, i) => {
    for (let r = 0; r < h; r++) {
      const ember = i === 2 && r === h - 1;
      cells.push(
        <div
          key={`${i}-${r}`}
          style={{
            position: "absolute",
            left: offsetX + i * cell,
            top: offsetY + (8 - r) * cell,
            width: cell,
            height: cell,
            background: ember ? "#c41e3a" : "#ffd900",
          }}
        />,
      );
    }
  });
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", background: "#050510", position: "relative", display: "flex" }}>{cells}</div>,
    size,
  );
}
