import { NextRequest, NextResponse } from "next/server";

import {
  createSale,
  getBranchNames,
  getSessionUser,
  getTransactions,
  type PaymentMethod,
} from "../../../lib/store";
import { checkoutReadiness } from "../../../lib/pos-readiness";

function isPaymentMethod(value: unknown): value is Exclude<PaymentMethod, "Mpesa"> {
  return value === "Cash" || value === "Card";
}

async function currentUser(request: NextRequest) {
  const token = request.cookies.get("ivans_session")?.value;
  return token ? getSessionUser(token) : null;
}

export async function GET(request: NextRequest) {
  try {
    const user = await currentUser(request);
    if (!user) return NextResponse.json({ message: "Sign in required." }, { status: 401 });

    const branch = user.role === "admin" ? undefined : user.branch;
    const transactions = await getTransactions(branch);
    return NextResponse.json({ transactions });
  } catch (error) {
    console.error("Unable to load transactions:", error);
    return NextResponse.json({ message: "Unable to load transactions." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await currentUser(request);
    if (!user) return NextResponse.json({ message: "Sign in required." }, { status: 401 });
    if (!checkoutReadiness.enabled) {
      return NextResponse.json({ message: checkoutReadiness.message }, { status: 503 });
    }

    const body: unknown = await request.json();
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return NextResponse.json({ message: "Sale details are invalid." }, { status: 400 });
    }
    const input = body as Record<string, unknown>;
    const cashTendered =
      input.paymentMethod === "Cash" && typeof input.cashTendered === "number"
        ? input.cashTendered
        : null;
    const discountApprovalId = typeof input.discountApprovalId === "string"
      ? input.discountApprovalId
      : undefined;
    const discountPercent = typeof input.discountPercent === "number"
      ? input.discountPercent
      : 0;
    if (
      !Array.isArray(input.items) ||
      input.items.length === 0 ||
      input.items.length > 100 ||
      input.items.some(
        (item: unknown) =>
          !item ||
          typeof item !== "object" ||
          typeof (item as { id?: unknown }).id !== "number" ||
          !Number.isSafeInteger((item as { id: number }).id) ||
          (item as { id: number }).id <= 0 ||
          typeof (item as { qty?: unknown }).qty !== "number" ||
          !Number.isSafeInteger((item as { qty: number }).qty) ||
          (item as { qty: number }).qty <= 0 ||
          (item as { qty: number }).qty > 9999,
      ) ||
      !isPaymentMethod(input.paymentMethod) ||
      (discountApprovalId !== undefined && !/^[0-9a-f-]{36}$/i.test(discountApprovalId)) ||
      !Number.isFinite(discountPercent) ||
      discountPercent < 0 ||
      discountPercent > 100 ||
      ((discountPercent > 0) !== Boolean(discountApprovalId)) ||
      (input.paymentMethod === "Cash" &&
        (cashTendered === null ||
          !Number.isFinite(cashTendered) ||
          cashTendered < 0 ||
          cashTendered > 9999999999))
    ) {
      return NextResponse.json({ message: "Sale details are invalid." }, { status: 400 });
    }

    const branch = user.role === "admin" ? input.branch : user.branch;
    if (
      typeof branch !== "string" ||
      !(await getBranchNames()).includes(branch) ||
      typeof input.registerId !== "string" ||
      !/^[0-9a-f-]{36}$/i.test(input.registerId)
    ) {
      return NextResponse.json({ message: "A valid branch and register are required." }, { status: 400 });
    }

    const transaction = await createSale({
      branch,
      registerId: input.registerId,
      cashierId: user.id,
      cashierName: user.name,
      customer: typeof input.customer === "string" && input.customer.trim()
        ? input.customer.trim().slice(0, 180)
        : "Walk-in customer",
      paymentMethod: input.paymentMethod,
      cashTendered: input.paymentMethod === "Cash" ? cashTendered : null,
      discountApprovalId,
      discountPercent,
      items: (input.items as { id: number; qty: number }[]).map((item) => ({
        id: item.id,
        qty: item.qty,
      })),
    });

    return NextResponse.json({ transaction, message: "Sale saved." });
  } catch (error) {
    const statusCode =
      typeof error === "object" && error !== null && "statusCode" in error
        ? Number(error.statusCode)
        : 500;
    if (statusCode === 400 || statusCode === 409) {
      return NextResponse.json(
        {
          message: error instanceof Error
            ? error.message
            : statusCode === 400
              ? "Sale details are invalid."
              : "Sale conflicts with current stock.",
        },
        { status: statusCode },
      );
    }
    console.error("Unable to save sale:", error);
    return NextResponse.json({ message: "Unable to save sale." }, { status: 500 });
  }
}
