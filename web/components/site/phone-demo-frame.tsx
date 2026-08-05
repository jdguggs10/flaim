import type { ReactNode } from "react";
import Image from "next/image";

interface PhoneDemoFrameProps {
  children: ReactNode;
  label: string;
}

export function PhoneFlaimMark({ size = 17 }: { size?: number }) {
  return (
    <>
      <Image
        src="/flaim-mark-hero.png"
        alt=""
        width={size}
        height={size}
        className="dark:hidden"
        aria-hidden="true"
      />
      <Image
        src="/flaim-mark-hero-dark.png"
        alt=""
        width={size}
        height={size}
        className="hidden dark:block"
        aria-hidden="true"
      />
    </>
  );
}

export function PhoneDemoFrame({ children, label }: PhoneDemoFrameProps) {
  return (
    <div
      className="phone-demo-frame relative mx-auto w-full max-w-[21.5rem] p-2"
      role="group"
      aria-label={label}
    >
      <span
        className="phone-demo-side-button phone-demo-side-button--mute"
        aria-hidden="true"
      />
      <span
        className="phone-demo-side-button phone-demo-side-button--volume-up"
        aria-hidden="true"
      />
      <span
        className="phone-demo-side-button phone-demo-side-button--volume-down"
        aria-hidden="true"
      />
      <span
        className="phone-demo-side-button phone-demo-side-button--power"
        aria-hidden="true"
      />

      <div className="phone-demo-screen relative aspect-[393/852] w-full overflow-hidden rounded-[3.1rem] border">
        <span className="phone-demo-sensor" aria-hidden="true" />
        {children}
      </div>
    </div>
  );
}
