import { NextRequest, NextResponse } from "next/server";

import { getSessionUser } from "../../../../lib/store";

export async function GET(request: NextRequest) {
  const token = request.cookies.get("ivans_session")?.value;

  if (!token) {
    return NextResponse.json({ user: null }, { status: 401 });
  }

  const user = await getSessionUser(token);
  if (!user) {
    return NextResponse.json({ user: null }, { status: 401 });
  }

  return NextResponse.json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      branch: user.branch,
    },
  });
}
