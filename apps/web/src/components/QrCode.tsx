import QRCode from "qrcode";
import { useEffect, useState } from "react";

export interface QrCodeProps {
  value: string;
  /** Text for screen readers and when the image cannot be shown. */
  label: string;
  size?: number;
}

/** A QR code drawn as an SVG data image. No markup from the library enters the page. */
export function QrCode({ value, label, size = 240 }: QrCodeProps) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    QRCode.toString(value, { type: "svg", errorCorrectionLevel: "M", margin: 2 })
      .then((svg) => {
        if (active) setSrc(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [value]);

  if (failed) return <p role="alert">Could not draw the QR code. Copy the link below instead.</p>;
  if (src === null) return <p>Drawing QR code…</p>;
  return <img className="qr" src={src} width={size} height={size} alt={label} />;
}
