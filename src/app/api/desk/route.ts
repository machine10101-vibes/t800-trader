import { buildDesk } from "@/lib/desk";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const desk = await buildDesk();
    return NextResponse.json(desk);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Desk failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
