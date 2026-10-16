import { NextRequest, NextResponse } from "next/server";

import { querySandboxStkPush } from "../../../../../../lib/daraja";
import {
  getMpesaPaymentAttempt,
  getSessionUser,
  updateMpesaPaymentVerification,
} from "../../../../../../lib/store";

type RouteContext = { params: Promise<{ id: string }> };

function maskPhoneNumber(phoneNumber: string): string {
  return `${phoneNumber.slice(0, 5)}****${phoneNumber.slice(-2)}`;
}

function publicAttempt(attempt: NonNullable<Awaited<ReturnType<typeof getMpesaPaymentAttempt>>>) {
  return {
    id: attempt.id,
    branch: attempt.branch,
    phoneNumber: maskPhoneNumber(attempt.phoneNumber),
    amount: attempt.amount,
    status: attempt.status,
    resultCode: attempt.resultCode,
    resultDescription: attempt.resultDescription,
    mpesaReceiptNumber: attempt.mpesaReceiptNumber,
    canQuery: Boolean(attempt.checkoutRequestId),
    createdAt: attempt.createdAt,
    updatedAt: attempt.updatedAt,
  };
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const token = request.cookies.get("ivans_session")?.value;
    const user = token ? await getSessionUser(token) : null;
    if (!user) return NextResponse.json({ message: "Sign in required." }, { status: 401 });

    const { id } = await context.params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      return NextResponse.json({ message: "Payment attempt ID is invalid." }, { status: 400 });
    }
    const attempt = await getMpesaPaymentAttempt(id, user.role === "admin" ? undefined : user.id);
    if (!attempt) return NextResponse.json({ message: "Payment attempt was not found." }, { status: 404 });
    if (attempt.status === "confirmed" || attempt.status === "failed") {
      return NextResponse.json({ attempt: publicAttempt(attempt), message: "This attempt is already final." });
    }

    const result = await querySandboxStkPush(attempt);
    if (result.resultCode === null) {
      return NextResponse.json({
        attempt: publicAttempt(attempt),
        message: "Daraja accepted the status query; this response is not proof of payment. Await the callback and verify again.",
      }, { status: 202 });
    }
    const updated = await updateMpesaPaymentVerification({
      id,
      checkoutRequestId: result.checkoutRequestId,
      resultCode: result.resultCode,
      resultDescription: result.resultDescription,
    });
    return NextResponse.json({
      attempt: publicAttempt(updated),
      message:
        updated.status === "confirmed"
          ? "Daraja status query and matching callback confirm this sandbox payment. No sale was created."
          : "Payment is not confirmed. A matching successful callback and final Daraja query are required.",
    }, { status: updated.status === "confirmed" ? 200 : 202 });
  } catch (error) {
    const statusCode =
      typeof error === "object" && error !== null && "statusCode" in error
        ? Number(error.statusCode)
        : 500;
    if (statusCode === 404 || statusCode === 409) {
      return NextResponse.json(
        { message: error instanceof Error ? error.message : "Payment attempt could not be verified." },
        { status: statusCode },
      );
    }
    console.error("Unable to query Daraja sandbox payment:", error);
    return NextResponse.json(
      { message: "Unable to query Daraja. The attempt remains unconfirmed." },
      { status: 502 },
    );
  }
}
