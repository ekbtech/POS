import { NextRequest, NextResponse } from "next/server";

import { getBranchNames, getSessionUser, updateStaff, type Role } from "../../../../lib/store";

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const token = request.cookies.get("ivans_session")?.value;
    const user = token ? await getSessionUser(token) : null;
    if (user?.role !== "admin") {
      return NextResponse.json({ message: "Administrator permission required." }, { status: 403 });
    }

    const { id } = await context.params;
    const body = await request.json();
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const branch = typeof body.branch === "string" ? body.branch.trim() : "";
    const role = body.role as Role;
    if (
      !id ||
      !name ||
      name.length > 160 ||
      !(await getBranchNames()).includes(branch) ||
      !["admin", "manager", "cashier"].includes(role)
    ) {
      return NextResponse.json({ message: "Staff details are invalid." }, { status: 400 });
    }
    const updated = await updateStaff(id, { name, role, branch });
    if (!updated) return NextResponse.json({ message: "Staff account not found." }, { status: 404 });
    return NextResponse.json({ message: "Staff account updated." });
  } catch (error) {
    console.error("Unable to update staff account:", error);
    return NextResponse.json({ message: "Unable to update staff account." }, { status: 500 });
  }
}
