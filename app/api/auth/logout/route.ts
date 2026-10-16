import { NextRequest, NextResponse } from "next/server";

import { deleteSession } from "../../../../lib/store";

export async function POST(request: NextRequest) {
  const token = request.cookies.get("ivans_session")?.value;
  try {
    if (token) await deleteSession(token);
    const response = NextResponse.json({ success: true });
    response.cookies.set("ivans_session", "", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 0,
    });
    return response;
  } catch (error) {
    console.error("Unable to revoke POS session:", error);
    const response = NextResponse.json({ message: "Unable to sign out." }, { status: 500 });
    response.cookies.set("ivans_session", "", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 0,
    });
    return response;
  }
}
