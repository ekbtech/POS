import { NextRequest, NextResponse } from "next/server";

import {
  createStaff,
  getBranchNames,
  getSessionUser,
  getStaff,
  type Role,
} from "../../../lib/store";

async function isAdmin(request: NextRequest) {
  const token = request.cookies.get("ivans_session")?.value;
  const user = token ? await getSessionUser(token) : null;
  return user?.role === "admin";
}

export async function GET(request: NextRequest) {
  try {
    if (!(await isAdmin(request))) {
      return NextResponse.json({ message: "Administrator permission required." }, { status: 403 });
    }
    return NextResponse.json({ staff: await getStaff() });
  } catch (error) {
    console.error("Unable to load staff:", error);
    return NextResponse.json({ message: "Unable to load staff." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    if (!(await isAdmin(request))) {
      return NextResponse.json({ message: "Administrator permission required." }, { status: 403 });
    }
    const body = await request.json();
    const allowedRoles: Role[] = ["manager", "cashier"];
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const role = body.role as Role;
    const branch = typeof body.branch === "string" ? body.branch.trim() : "";

    if (
      !name ||
      name.length > 160 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      email.length > 254 ||
      password.length < 10 ||
      Buffer.byteLength(password, "utf8") > 72 ||
      !allowedRoles.includes(role) ||
      !(await getBranchNames()).includes(branch)
    ) {
      return NextResponse.json(
        { message: "Enter a name, valid email, password of at least 10 characters, role, and branch." },
        { status: 400 },
      );
    }

    const staff = await createStaff({ name, email, password, role: role as "manager" | "cashier", branch });
    return NextResponse.json({ staff }, { status: 201 });
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ER_DUP_ENTRY"
    ) {
      return NextResponse.json({ message: "An account with that email already exists." }, { status: 409 });
    }
    console.error("Unable to create staff account:", error);
    return NextResponse.json({ message: "Unable to create staff account." }, { status: 500 });
  }
}
