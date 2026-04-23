import type { Metadata } from 'next';
import { SignIn } from '@clerk/nextjs';

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

export default function Page() {
  return (
    <div className="flex items-center justify-center min-h-[50vh] py-12">
      <SignIn />
    </div>
  );
}
