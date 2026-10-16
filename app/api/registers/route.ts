import { NextRequest, NextResponse } from "next/server";

import {
  createRegister,
  getBranchNames,
  getRegisters,
  getSessionUser,
} from "../../../lib/store";

async function currentUser(request: NextRequest) {
  const token = request.cookies.get("ivans_session")?.value;
  return token ? getSessionUser(token) : null;
}

export async function GET(request: NextRequest) {
  try {
    const user = await currentUser(request);
    if (!user) return NextResponse.json({ message: "Sign in required." }, { status: 401 });
    const requestedBranch = request.nextUrl.searchParams.get("branch");
    const branch = user.role === "admin" ? requestedBranch || user.branch : user.branch;
    if (!(await getBranchNames()).includes(branch)) {
      return NextResponse.json({ message: "A valid branch is required." }, { status: 400 });
    }
    return NextResponse.json({ registers: await getRegisters(branch) });
  } catch (error) {
    console.error("Unable to load POS registers:", error);
    return NextResponse.json({ message: "Unable to load POS registers." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await currentUser(request);
    if (!user) return NextResponse.json({ message: "Sign in required." }, { status: 401 });
    if (user.role === "cashier") {
      return NextResponse.json({ message: "Manager permission is required to add a register." }, { status: 403 });
    }
    const body: unknown = await request.json();
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return NextResponse.json({ message: "Register details are invalid." }, { status: 400 });
    }
    const input = body as Record<string, unknown>;
    const branch = user.role === "admin" && typeof input.branch === "string"
      ? input.branch.trim()
      : user.branch;
    const name = typeof input.name === "string" ? input.name.trim() : "";
    if (
      !name ||
      name.length > 80 ||
      /[\u0000-\u001F]/.test(name) ||
      !(await getBranchNames()).includes(branch)
    ) {
      return NextResponse.json({ message: "Enter a register name (up to 80 characters) and a valid branch." }, { status: 400 });
    }
    const register = await createRegister({ branch, name });
    return NextResponse.json({ register }, { status: 201 });
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ER_DUP_ENTRY"
    ) {
      return NextResponse.json({ message: "That register name already exists at this branch." }, { status: 409 });
    }
    console.error("Unable to create POS register:", error);
    return NextResponse.json({ message: "Unable to create POS register." }, { status: 500 });
  }
}
