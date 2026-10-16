import { NextRequest, NextResponse } from "next/server";

import { getBranchNames, getSalesReport, getSessionUser } from "../../../lib/store";

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const isValidDate = (value: string) => {
  if (!datePattern.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
};

export async function GET(request: NextRequest) {
  const token = request.cookies.get("ivans_session")?.value;
  try {
    const user = token ? await getSessionUser(token) : null;
    if (!user) return NextResponse.json({ message: "Sign in required." }, { status: 401 });
    if (user.role === "cashier") {
      return NextResponse.json({ message: "You do not have permission to view reports." }, { status: 403 });
    }

    const today = new Date().toISOString().slice(0, 10);
    const params = request.nextUrl.searchParams;
    const from = params.get("from") || today;
    const to = params.get("to") || today;
    if (!isValidDate(from) || !isValidDate(to) || from > to) {
      return NextResponse.json({ message: "Choose a valid date range." }, { status: 400 });
    }

    const branch = user.role === "admin" ? params.get("branch") || undefined : user.branch;
    if (branch && !(await getBranchNames()).includes(branch)) {
      return NextResponse.json({ message: "Choose a valid branch." }, { status: 400 });
    }
    const report = await getSalesReport({ from, to, branch });
    return NextResponse.json({ report });
  } catch (error) {
    console.error("Unable to load sales report:", error);
    return NextResponse.json({ message: "Unable to load sales report." }, { status: 500 });
  }
}
