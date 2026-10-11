import { Landing } from "@/components/landing/Landing";
import type { Metadata } from "next";
import { Rajdhani } from "next/font/google";

const display = Rajdhani({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-display",
});

export const metadata: Metadata = {
  title: "T-800 Trader",
  description: "Solana and Cronos desk. The coins in the ring are the names it trades. Practice money is the default.",
};

export default function Page() {
  return (
    <div className={display.variable}>
      <Landing />
    </div>
  );
}
