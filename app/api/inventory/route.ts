import { NextRequest, NextResponse } from "next/server";

import {
  getBranchNames,
  getSessionUser,
  getStockMovements,
  recordStockMovement,
} from "../../../lib/store";

function isStockMovement(value: unknown): value is "opening" | "receipt" | "adjustment" {
  return value === "opening" || value === "receipt" || value === "adjustment";
}

export async function GET(request: NextRequest) {
  try {
    const token = request.cookies.get("ivans_session")?.value;
    const user = token ? await getSessionUser(token) : null;
    if (!user) return NextResponse.json({ message: "Sign in required." }, { status: 401 });
    if (user.role === "cashier") {
      return NextResponse.json({ message: "You do not have permission to view inventory movements." }, { status: 403 });
    }

    const branches = await getBranchNames();
    const requestedBranch = request.nextUrl.searchParams.get("branch");
    const branch = user.role === "admin" ? requestedBranch || branches[0] : user.branch;
    if (!branch || !branches.includes(branch)) {
      return NextResponse.json({ message: "Choose a valid branch." }, { status: 400 });
    }
    return NextResponse.json({ movements: await getStockMovements(branch) });
  } catch (error) {
    console.error("Unable to load inventory movements:", error);
    return NextResponse.json({ message: "Unable to load inventory movements." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const token = request.cookies.get("ivans_session")?.value;
    const user = token ? await getSessionUser(token) : null;
    if (!user) return NextResponse.json({ message: "Sign in required." }, { status: 401 });
    if (user.role === "cashier") {
      return NextResponse.json({ message: "You do not have permission to manage inventory." }, { status: 403 });
    }

    const body: unknown = await request.json();
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return NextResponse.json({ message: "Stock movement details are invalid." }, { status: 400 });
    }
    const input = body as Record<string, unknown>;
    const movement = input.movement;
    const quantity = input.quantity;
    const reorderLevel = input.reorderLevel;
    const reason = typeof input.reason === "string" ? input.reason.trim() : "";
    if (
      !isStockMovement(movement) ||
      typeof input.productId !== "number" ||
      !Number.isSafeInteger(input.productId) ||
      input.productId <= 0 ||
      typeof quantity !== "number" ||
      !Number.isInteger(quantity) ||
      Math.abs(quantity) > 2147483647 ||
      (movement === "opening" ? quantity < 0 : movement === "receipt" ? quantity <= 0 : quantity === 0) ||
      (reorderLevel !== undefined &&
        (typeof reorderLevel !== "number" ||
          !Number.isInteger(reorderLevel) ||
          reorderLevel < 0 ||
          reorderLevel > 2147483647)) ||
      reason.length < 3 ||
      reason.length > 240
    ) {
      return NextResponse.json({ message: "Enter a valid stock movement, quantity, and reason." }, { status: 400 });
    }

    const branches = await getBranchNames();
    const branch = user.role === "admin" ? input.branch : user.branch;
    if (typeof branch !== "string" || !branches.includes(branch)) {
      return NextResponse.json({ message: "Choose a valid branch." }, { status: 400 });
    }

    const inventory = await recordStockMovement({
      branch,
      productId: input.productId,
      movement,
      quantity,
      reorderLevel,
      reason,
      userId: user.id,
    });
    return NextResponse.json({ inventory, message: "Stock movement recorded." });
  } catch (error) {
    const statusCode =
      typeof error === "object" && error !== null && "statusCode" in error
        ? Number(error.statusCode)
        : 500;
    if (statusCode === 404 || statusCode === 409) {
      return NextResponse.json(
        { message: error instanceof Error ? error.message : "Stock movement conflicts with current inventory." },
        { status: statusCode },
      );
    }
    console.error("Unable to record stock movement:", error);
    return NextResponse.json({ message: "Unable to record stock movement." }, { status: 500 });
  }
}
