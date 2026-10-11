import { DeskApp } from "@/components/desk/DeskApp";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Desk · T-800 Trader",
  description: "Solana and Cronos trading desk. Practice money is the default. Live spends only after you arm.",
};

export default function DeskPage() {
  return <DeskApp />;
}
