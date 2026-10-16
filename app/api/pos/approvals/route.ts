import { NextRequest, NextResponse } from "next/server";

import {
  getBranchNames,
  getPosApprovalHistory,
  getProducts,
  getRegisters,
  getSessionUser,
  recordPosManagerApproval,
  verifyCredentials,
} from "../../../../lib/store";

type CartSnapshot = { id: number; qty: number }[];

async function currentUser(request: NextRequest) {
  const token = request.cookies.get("ivans_session")?.value;
  return token ? getSessionUser(token) : null;
}

function errorStatus(error: unknown) {
  return typeof error === "object" && error !== null && "statusCode" in error
    ? Number(error.statusCode)
    : 500;
}

function readCartSnapshot(value: unknown): CartSnapshot | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) return null;
  const items: CartSnapshot = [];
  const ids = new Set<number>();
  for (const entry of value) {
    if (
      typeof entry !== "object" ||
      entry === null ||
      typeof (entry as { id?: unknown }).id !== "number" ||
      !Number.isSafeInteger((entry as { id: number }).id) ||
      (entry as { id: number }).id <= 0 ||
      typeof (entry as { qty?: unknown }).qty !== "number" ||
      !Number.isSafeInteger((entry as { qty: number }).qty) ||
      (entry as { qty: number }).qty <= 0 ||
      (entry as { qty: number }).qty > 9999 ||
      ids.has((entry as { id: number }).id)
    ) {
      return null;
    }
    const item = entry as { id: number; qty: number };
    ids.add(item.id);
    items.push({ id: item.id, qty: item.qty });
  }
  return items;
}

export async function POST(request: NextRequest) {
  try {
    const operator = await currentUser(request);
    if (!operator) return NextResponse.json({ message: "Sign in required." }, { status: 401 });

    const body: unknown = await request.json();
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return NextResponse.json({ message: "Approval details are invalid." }, { status: 400 });
    }

    const input = body as Record<string, unknown>;
    const action = input.action;
    const actionKey = typeof input.actionKey === "string" ? input.actionKey : "";
    const registerId = typeof input.registerId === "string" ? input.registerId : "";
    const shiftId = typeof input.shiftId === "string" ? input.shiftId : "";
    const requestedBranch = typeof input.branch === "string" ? input.branch.trim() : "";
    const branch = operator.role === "admin" ? requestedBranch || operator.branch : operator.branch;
    const reason = typeof input.reason === "string" ? input.reason.trim() : "";
    const managerEmail = typeof input.managerEmail === "string" ? input.managerEmail.trim() : "";
    const managerPassword = typeof input.managerPassword === "string" ? input.managerPassword : "";
    const cartItems = readCartSnapshot(input.cartItems);
    if (
      (action !== "cart_item_void" && action !== "basket_discount") ||
      !/^[0-9a-f-]{36}$/i.test(actionKey) ||
      !/^[0-9a-f-]{36}$/i.test(registerId) ||
      !/^[0-9a-f-]{36}$/i.test(shiftId) ||
      !reason ||
      reason.length > 255 ||
      !managerEmail ||
      !managerPassword ||
      !cartItems ||
      !(await getBranchNames()).includes(branch)
    ) {
      return NextResponse.json({ message: "Enter a reason, valid basket, register, and manager credentials." }, { status: 400 });
    }

    const register = (await getRegisters(branch)).find((item) => item.id === registerId);
    if (!register || register.openShift?.id !== shiftId) {
      return NextResponse.json({ message: "An open shift is required to approve a cashier action." }, { status: 409 });
    }
    const products = await getProducts(branch);
    const productMap = new Map(products.map((product) => [product.id, product]));
    let subtotalCents = 0;
    for (const item of cartItems) {
      const product = productMap.get(item.id);
      if (!product || !product.stockCounted || item.qty > product.stock) {
        return NextResponse.json({ message: "Basket has an unavailable item or unverified stock." }, { status: 409 });
      }
      subtotalCents += Math.round(product.price * 100) * item.qty;
    }

    const details: Record<string, unknown> = {
      cartItems,
      subtotalCents,
    };
    if (action === "basket_discount") {
      if (
        typeof input.discountPercent !== "number" ||
        !Number.isFinite(input.discountPercent) ||
        input.discountPercent <= 0 ||
        input.discountPercent > 100 ||
        Math.round(input.discountPercent * 100) !== input.discountPercent * 100
      ) {
        return NextResponse.json({ message: "Discount must be a percentage greater than 0 and no more than 100." }, { status: 400 });
      }
      details.discountPercent = input.discountPercent;
      details.discountCents = Math.round(subtotalCents * input.discountPercent / 100);
    } else {
      if (
        typeof input.productId !== "number" ||
        !Number.isSafeInteger(input.productId) ||
        typeof input.removeQuantity !== "number" ||
        input.removeQuantity !== 1 ||
        !cartItems.some((item) => item.id === input.productId)
      ) {
        return NextResponse.json({ message: "The cart item to void is invalid." }, { status: 400 });
      }
      details.productId = input.productId;
      details.removeQuantity = input.removeQuantity;
    }

    const approver = await verifyCredentials(managerEmail, managerPassword);
    if (
      !approver ||
      approver.id === operator.id ||
      (approver.role !== "manager" && approver.role !== "admin") ||
      (approver.role !== "admin" && approver.branch !== branch)
    ) {
      return NextResponse.json(
        { message: "Approval requires a different manager or administrator assigned to this branch." },
        { status: 403 },
      );
    }

    const approval = await recordPosManagerApproval({
      actionKey,
      branch,
      registerId,
      shiftId,
      operatorId: operator.id,
      approverId: approver.id,
      action,
      reason,
      details,
    });
    return NextResponse.json({
      approval: { id: approval.id, approverName: approval.approverName, action, created: approval.created },
    }, { status: approval.created ? 201 : 200 });
  } catch (error) {
    const status = errorStatus(error);
    if ([400, 403, 404, 409].includes(status)) {
      return NextResponse.json(
        { message: error instanceof Error ? error.message : "Approval could not be recorded." },
        { status },
      );
    }
    console.error("Unable to record manager approval:", error);
    return NextResponse.json({ message: "Unable to record manager approval." }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const user = await currentUser(request);
    if (!user) return NextResponse.json({ message: "Sign in required." }, { status: 401 });
    const registerId = request.nextUrl.searchParams.get("registerId") ?? "";
    const requestedBranch = request.nextUrl.searchParams.get("branch") ?? "";
    const branch = user.role === "admin" ? requestedBranch || user.branch : user.branch;
    if (!/^[0-9a-f-]{36}$/i.test(registerId) || !(await getBranchNames()).includes(branch)) {
      return NextResponse.json({ message: "Register details are invalid." }, { status: 400 });
    }
    const history = await getPosApprovalHistory({
      registerId,
      branch,
      operatorId: user.role === "cashier" ? user.id : undefined,
      limit: 10,
    });
    return NextResponse.json({ history });
  } catch (error) {
    console.error("Unable to load manager approval history:", error);
    return NextResponse.json({ message: "Unable to load manager approval history." }, { status: 500 });
  }
}
