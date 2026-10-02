import { ImageResponse } from "next/og";

export const alt = "PointUp - your points have places to go";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Social-share card, rendered from brand tokens at request time. */
export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "80px",
          backgroundColor: "#DFEBF8",
        }}
      >
        <svg width="120" height="120" viewBox="0 0 256 256">
          <circle cx="76" cy="182" r="13" fill="#215BCC" />
          <circle cx="110" cy="148" r="16" fill="#4684DE" />
          <circle cx="144" cy="114" r="19" fill="#215BCC" />
          <path d="M140 60 h58 v58 z" fill="#215BCC" />
        </svg>
        <div
          style={{
            marginTop: 40,
            fontSize: 88,
            fontWeight: 700,
            color: "#152B46",
            display: "flex",
          }}
        >
          Point<span style={{ color: "#215BCC" }}>Up</span>
        </div>
        <div style={{ marginTop: 16, fontSize: 36, color: "#4B6077" }}>
          Your points have places to go.
        </div>
      </div>
    ),
    size,
  );
}
