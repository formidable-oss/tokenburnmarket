import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";

/*
  Default share card. Route-specific cards (profile, market, leaderboard) come with issue #13
  and should reuse this composition: mark top-left, one big line, one quiet line, ember accent.
*/
export const alt = "tokenburnmarket. Bet your burn.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const BARS = [3, 5, 9, 6, 4];

function Mark({ cell }: { cell: number }) {
  const cells: React.ReactNode[] = [];
  BARS.forEach((h, i) => {
    for (let r = 0; r < h; r++) {
      const ember = i === 2 && r === h - 1;
      cells.push(
        <div
          key={`${i}-${r}`}
          style={{
            position: "absolute",
            left: (2 + i) * cell,
            top: (9 - r) * cell,
            width: cell,
            height: cell,
            background: ember ? "#c41e3a" : "#ffd900",
          }}
        />,
      );
    }
  });
  return <div style={{ position: "relative", width: cell * 11, height: cell * 11, display: "flex" }}>{cells}</div>;
}

export default async function OpenGraphImage() {
  const pixel = await readFile(new URL("./GeistPixel-Circle.ttf", import.meta.url));
  const mono = await readFile(new URL("./GeistMono-Medium.ttf", import.meta.url));
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 72,
          background: "#050510",
          color: "#f0f0f5",
          fontFamily: "Geist Pixel Circle",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <Mark cell={6} />
          <div style={{ fontSize: 34, fontFamily: "Geist Mono", display: "flex" }}>
            token<span style={{ color: "#ffe452" }}>burn</span>market
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div style={{ fontSize: 132, lineHeight: 1, display: "flex" }}>
            Bet your&nbsp;<span style={{ color: "#ffd900" }}>burn</span>.
          </div>
          <div style={{ fontSize: 30, color: "#9090a0", fontFamily: "Geist Mono" }}>
            Play money. Real bragging rights.
          </div>
        </div>
      </div>
    ),
    { ...size, fonts: [
        { name: "Geist Pixel Circle", data: pixel, style: "normal", weight: 400 },
        { name: "Geist Mono", data: mono, style: "normal", weight: 500 },
      ] },
  );
}
