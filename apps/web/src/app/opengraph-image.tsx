import { ImageResponse } from "next/og";

export const alt = "PointUp - all your points, one clear view";
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
          backgroundColor: "#0B1020",
          backgroundImage:
            "radial-gradient(800px 400px at 85% 10%, rgba(124,92,255,0.35), transparent), radial-gradient(600px 300px at 10% 90%, rgba(255,181,71,0.18), transparent)",
        }}
      >
        <svg width="120" height="120" viewBox="0 0 256 256">
          <circle cx="76" cy="182" r="13" fill="#7C5CFF" />
          <circle cx="110" cy="148" r="16" fill="#A78BFA" />
          <circle cx="144" cy="114" r="19" fill="#C7A4FF" />
          <path d="M140 60 h58 v58 z" fill="#FFB547" />
        </svg>
        <div
          style={{
            marginTop: 40,
            fontSize: 88,
            fontWeight: 700,
            color: "#F4F6FF",
            display: "flex",
          }}
        >
          Point<span style={{ color: "#7C5CFF" }}>Up</span>
        </div>
        <div style={{ marginTop: 16, fontSize: 36, color: "#9AA5CB" }}>
          All your points. One clear view.
        </div>
      </div>
    ),
    size,
  );
}
