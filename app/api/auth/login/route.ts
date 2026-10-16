import { NextRequest, NextResponse } from "next/server";

import { createSession, verifyCredentials } from "../../../../lib/store";

export async function POST(request: NextRequest) {
  try {
    const { email, password } = await request.json();

    if (!email || !password) {
      return NextResponse.json({ message: "Email and password are required." }, { status: 400 });
    }

    const user = await verifyCredentials(email, password);
    if (!user) {
      return NextResponse.json({ message: "Invalid email or password." }, { status: 401 });
    }

    const token = await createSession(user.id);
    const response = NextResponse.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        branch: user.branch,
      },
    });

    response.cookies.set("ivans_session", token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24,
    });

    return response;
  } catch {
    return NextResponse.json({ message: "Unable to complete login." }, { status: 500 });
  }
}
