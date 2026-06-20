import { useEffect } from "react";

interface AdSenseBannerProps {
  client: string; // e.g. "ca-pub-XXXXXXXXXXXXXXXX"
  slot: string;   // e.g. "1234567890"
}

export default function AdSenseBanner({ client, slot }: AdSenseBannerProps) {
  // Safe check to verify if the app is running in the native Capacitor shell
  const isNativeApp = typeof window !== "undefined" && !!((window as any).Capacitor?.isNativePlatform?.());

  useEffect(() => {
    if (isNativeApp) return;

    try {
      // Request Google AdSense to load and render the ad slot
      ((window as any).adsbygoogle = (window as any).adsbygoogle || []).push({});
    } catch (e) {
      console.warn("AdSense push warning:", e);
    }
  }, [isNativeApp]);

  // Render absolutely nothing inside the Android/iOS app to comply with AdSense policies
  if (isNativeApp) return null;

  return (
    <div className="my-3 flex justify-center overflow-hidden rounded-xl bg-black/20 p-1 border border-white/5">
      <ins
        className="adsbygoogle"
        style={{ display: "block", width: "100%", height: "90px" }}
        data-ad-client={client}
        data-ad-slot={slot}
        data-ad-format="horizontal"
        data-full-width-responsive="false"
      />
    </div>
  );
}
