import { NextRequest, NextResponse } from "next/server";

import {
  closeRegisterShift,
  getBranchNames,
  getRegisterShiftHistory,
  getRegisters,
  getSessionUser,
  openRegisterShift,
} from "../../../lib/store";

async function currentUser(request: NextRequest) {
  const token = request.cookies.get("ivans_session")?.value;
  return token ? getSessionUser(token) : null;
}

function errorStatus(error: unknown) {
  return typeof error === "object" && error !== null && "statusCode" in error
    ? Number(error.statusCode)
    : 500;
}

export async function GET(request: NextRequest) {
  try {
    const user = await currentUser(request);
    if (!user) return NextResponse.json({ message: "Sign in required." }, { status: 401 });
    const registerId = request.nextUrl.searchParams.get("registerId") ?? "";
    const requestedBranch = request.nextUrl.searchParams.get("branch");
    const branch = user.role === "admin" ? requestedBranch || user.branch : user.branch;
    if (!/^[0-9a-f-]{36}$/i.test(registerId) || !(await getBranchNames()).includes(branch)) {
      return NextResponse.json({ message: "Register details are invalid." }, { status: 400 });
    }
    const register = (await getRegisters(branch)).find((item) => item.id === registerId);
    if (!register) return NextResponse.json({ message: "Register was not found." }, { status: 404 });
    const history = await getRegisterShiftHistory({ registerId, branch, limit: 10 });
    return NextResponse.json({ register, history });
  } catch (error) {
    console.error("Unable to load register shift:", error);
    return NextResponse.json({ message: "Unable to load register shift." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await currentUser(request);
    if (!user) return NextResponse.json({ message: "Sign in required." }, { status: 401 });
    const body: unknown = await request.json();
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return NextResponse.json({ message: "Shift details are invalid." }, { status: 400 });
    }
    const input = body as Record<string, unknown>;
    const registerId = typeof input.registerId === "string" ? input.registerId : "";
    const action = input.action;
    const amount = action === "open" ? input.openingCash : input.closingCash;
    const reason = typeof input.reason === "string" ? input.reason.trim().slice(0, 255) : "";
    if (
      !/^[0-9a-f-]{36}$/i.test(registerId) ||
      (action !== "open" && action !== "close") ||
      typeof amount !== "number" ||
      !Number.isFinite(amount) ||
      amount < 0 ||
      amount > 9999999999 ||
      Math.round(amount * 100) !== amount * 100
    ) {
      return NextResponse.json({ message: "Enter a valid register and cash count." }, { status: 400 });
    }

    const requestedBranch = typeof input.branch === "string" ? input.branch : "";
    const branch = user.role === "admin" ? requestedBranch || user.branch : user.branch;
    if (!(await getBranchNames()).includes(branch)) {
      return NextResponse.json({ message: "A valid branch is required." }, { status: 400 });
    }

    const result = action === "open"
      ? await openRegisterShift({
          registerId,
          branch,
          userId: user.id,
          canOpenOtherBranch: user.role === "admin",
          openingCash: amount,
          reason: reason || null,
        })
      : await closeRegisterShift({
          registerId,
          branch,
          userId: user.id,
          canCloseOtherCashierShift: true,
          closingCash: amount,
          reason: reason || null,
        });
    return NextResponse.json({ shift: result });
  } catch (error) {
    const status = errorStatus(error);
    if ([400, 403, 404, 409].includes(status)) {
      return NextResponse.json(
        { message: error instanceof Error ? error.message : "Shift action could not be completed." },
        { status },
      );
    }
    console.error("Unable to update register shift:", error);
    return NextResponse.json({ message: "Unable to update register shift." }, { status: 500 });
  }
}
