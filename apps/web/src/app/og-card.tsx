import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import type { ShareCard } from "@/lib/share-cards";

/*
  The one composition every share card is drawn with: mark and wordmark top-left,
  a headline in the pixel face, an optional panel of rows on the right, one quiet
  line at the bottom. Routes never lay out pixels; they map their data to a
  ShareCard (lib/share-cards.ts) and hand it here.
*/
export const CARD_SIZE = { width: 1200, height: 630 };

const BARS = [3, 5, 9, 6, 4];

const INK = {
  background: "#050510",
  surface: "#0f0f1f",
  sunken: "#0a0a1a",
  border: "#252535",
  foreground: "#f0f0f5",
  muted: "#9090a0",
  subtle: "#767686",
  primary: "#ffd900",
  primaryText: "#ffe452",
  ember: "#c41e3a",
  cyber: "#00f0ff",
};

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
            background: ember ? INK.ember : INK.primary,
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

/*
  The headline is one string plus, at most, one word painted yellow: the same
  "one primary per view" rule the pages follow.
*/
function Headline({ card }: { card: ShareCard }) {
  const at = card.accent ? card.headline.indexOf(card.accent) : -1;
  const style = {
    fontFamily: "Geist Pixel Circle",
    fontSize: card.headlineSize,
    lineHeight: 1.08,
    display: "flex",
    flexWrap: "wrap" as const,
  };
  if (at < 0) return <div style={style}>{card.headline}</div>;
  return (
    <div style={style}>
      {/* The space before the accent is non-breaking: flex layout would eat a trailing one. */}
      {card.headline.slice(0, at).replace(/ $/, " ")}
      <span style={{ color: INK.primary }}>{card.accent}</span>
      {card.headline.slice(at + card.accent!.length)}
    </div>
  );
}

function Panel({ card }: { card: ShareCard }) {
  const rows = card.rows ?? [];
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: 400,
        flexShrink: 0,
        border: `1px solid ${INK.border}`,
        borderRadius: 14,
        background: INK.surface,
        padding: 22,
        gap: 14,
      }}
    >
      {card.panelTitle ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            fontSize: 14,
            color: INK.muted,
            letterSpacing: 1,
          }}
        >
          {card.live ? (
            <div style={{ width: 8, height: 8, borderRadius: 8, background: INK.ember }} />
          ) : null}
          {card.panelTitle.toUpperCase()}
        </div>
      ) : null}
      {rows.map((row) => (
        <div key={row.label} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 20, gap: 16 }}>
            <span style={{ color: INK.foreground }}>{row.label}</span>
            <span style={{ color: row.tone === "price" ? INK.cyber : INK.foreground }}>
              {row.value}
            </span>
          </div>
          {row.fill === undefined ? null : (
            <div style={{ display: "flex", height: 6, background: INK.sunken, borderRadius: 3 }}>
              <div
                style={{
                  width: `${Math.round(row.fill * 100)}%`,
                  background: INK.primary,
                  borderRadius: 3,
                }}
              />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export async function renderCard(card: ShareCard) {
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
          background: INK.background,
          backgroundImage:
            "radial-gradient(700px 360px at 90% -10%, rgba(255,217,0,0.09), transparent 60%)",
          color: INK.foreground,
          fontFamily: "Geist Mono",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <Mark cell={5} />
          <div style={{ fontSize: 30, display: "flex" }}>
            token<span style={{ color: INK.primaryText }}>burn</span>market
          </div>
        </div>

        <div
          style={{
            display: "flex",
            flex: 1,
            alignItems: "flex-end",
            justifyContent: "space-between",
            gap: 48,
          }}
        >
          <div style={{ display: "flex", flex: 1, minWidth: 0, flexDirection: "column", gap: 20 }}>
            {card.eyebrow ? (
              <div style={{ fontSize: 18, color: INK.muted, letterSpacing: 1.4 }}>
                {card.eyebrow.toUpperCase()}
              </div>
            ) : null}
            <Headline card={card} />
            {card.subline ? (
              <div style={{ fontSize: 22, color: INK.muted, maxWidth: 560, lineHeight: 1.35 }}>
                {card.subline}
              </div>
            ) : null}
          </div>

          {card.rows && card.rows.length > 0 ? <Panel card={card} /> : null}
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: 18,
            color: INK.subtle,
            marginTop: 40,
          }}
        >
          <span>{card.footer}</span>
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
