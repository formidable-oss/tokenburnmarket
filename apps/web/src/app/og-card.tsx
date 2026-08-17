import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";

/*
  Shared composition for share cards (OG and Twitter). Mark and wordmark top-left, one big line,
  a small live market strip on the right, one quiet line at the bottom.
  Route-specific cards (issue #13) should reuse renderCard and change the copy and rows.
*/
export const CARD_SIZE = { width: 1200, height: 630 };

const BARS = [3, 5, 9, 6, 4];
const rows = [
  { who: "@alex", p: 0.42 },
  { who: "@theo", p: 0.31 },
  { who: "@mira", p: 0.19 },
];

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
  const corner = { position: "absolute" as const, background: "#f0f0f588" };
  return (
    <div style={{ position: "relative", width: cell * 11, height: cell * 11, display: "flex" }}>
      <div style={{ ...corner, left: 0, top: 0, width: cell * 3, height: 2 }} />
      <div style={{ ...corner, left: 0, top: 0, width: 2, height: cell * 3 }} />
      <div style={{ ...corner, right: 0, bottom: 0, width: cell * 3, height: 2 }} />
      <div style={{ ...corner, right: 0, bottom: 0, width: 2, height: cell * 3 }} />
      {cells}
    </div>
  );
}

export async function renderCard() {
  const [pixel, mono] = await Promise.all([
    readFile(new URL("./GeistPixel-Circle.ttf", import.meta.url)),
    readFile(new URL("./GeistMono-Medium.ttf", import.meta.url)),
  ]);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          padding: 64,
          background: "#050510",
          backgroundImage: "radial-gradient(700px 360px at 90% -10%, rgba(255,217,0,0.09), transparent 60%)",
          color: "#f0f0f5",
          fontFamily: "Geist Mono",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <Mark cell={5} />
          <div style={{ fontSize: 30, display: "flex" }}>
            token<span style={{ color: "#ffe452" }}>burn</span>market
          </div>
        </div>

        <div style={{ display: "flex", flex: 1, alignItems: "flex-end", justifyContent: "space-between", gap: 48 }}>
          <div style={{ display: "flex", flex: 1, minWidth: 0, flexDirection: "column", gap: 22 }}>
            <div style={{ fontFamily: "Geist Pixel Circle", fontSize: 100, lineHeight: 1, display: "flex" }}>
              Bet your&nbsp;<span style={{ color: "#ffd900" }}>burn</span>.
            </div>
            <div style={{ fontSize: 24, color: "#9090a0", maxWidth: 560, lineHeight: 1.35 }}>
              Your agent usage becomes credits. Credits become bets on who burns what next.
            </div>
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              width: 320,
              flexShrink: 0,
              border: "1px solid #252535",
              borderRadius: 14,
              background: "#0f0f1f",
              padding: 22,
              gap: 14,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14, color: "#9090a0", letterSpacing: 1 }}>
              <div style={{ width: 8, height: 8, borderRadius: 8, background: "#c41e3a" }} />
              LIVE · THIS WEEK
            </div>
            <div style={{ fontFamily: "Geist Pixel Circle", fontSize: 24, lineHeight: 1.15 }}>Who burns most?</div>
            {rows.map((r) => (
              <div key={r.who} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 18 }}>
                  <span>{r.who}</span>
                  <span style={{ color: "#00f0ff" }}>{Math.round(r.p * 100)}¢</span>
                </div>
                <div style={{ display: "flex", height: 6, background: "#0a0a1a", borderRadius: 3 }}>
                  <div style={{ width: `${r.p * 100}%`, background: "#ffd900", borderRadius: 3 }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 18, color: "#767686", marginTop: 40 }}>
          <span>Play money. Real bragging rights.</span>
          <span>tokenburnmarket</span>
        </div>
      </div>
    ),
    {
      ...CARD_SIZE,
      fonts: [
        { name: "Geist Pixel Circle", data: pixel, style: "normal", weight: 400 },
        { name: "Geist Mono", data: mono, style: "normal", weight: 500 },
      ],
    },
  );
}
