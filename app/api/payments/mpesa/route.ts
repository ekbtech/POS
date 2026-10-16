import { NextRequest, NextResponse } from "next/server";

import {
  createMpesaPaymentAttempt,
  getSessionUser,
  listMpesaPaymentAttempts,
  updateMpesaPaymentSubmission,
} from "../../../../lib/store";
import {
  assertSandboxDarajaConfigured,
  initiateSandboxStkPush,
  normalizeKenyanPhoneNumber,
} from "../../../../lib/daraja";

function maskPhoneNumber(phoneNumber: string): string {
  return `${phoneNumber.slice(0, 5)}****${phoneNumber.slice(-2)}`;
}

function publicAttempt(attempt: Awaited<ReturnType<typeof listMpesaPaymentAttempts>>[number]) {
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

async function currentUser(request: NextRequest) {
  const token = request.cookies.get("ivans_session")?.value;
  return token ? getSessionUser(token) : null;
}

export async function GET(request: NextRequest) {
  try {
    const user = await currentUser(request);
    if (!user) return NextResponse.json({ message: "Sign in required." }, { status: 401 });
    const attempts = await listMpesaPaymentAttempts(100, user.role === "admin" ? undefined : user.id);
    let configurationMessage = "";
    let configured = true;
    try {
      assertSandboxDarajaConfigured();
    } catch (error) {
      configured = false;
      configurationMessage = error instanceof Error
        ? error.message
        : "Daraja sandbox is not configured.";
    }
    return NextResponse.json({
      attempts: attempts.map(publicAttempt),
      environment: configured ? "sandbox" : "disabled",
      configurationMessage,
    });
  } catch (error) {
    console.error("Unable to load M-Pesa sandbox attempts:", error);
    return NextResponse.json({ message: "Unable to load M-Pesa test payments." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  let attemptId: string | undefined;
  try {
    const user = await currentUser(request);
    if (!user) return NextResponse.json({ message: "Sign in required." }, { status: 401 });

    try {
      assertSandboxDarajaConfigured();
    } catch (error) {
      return NextResponse.json(
        { message: error instanceof Error ? error.message : "Daraja sandbox is not configured." },
        { status: 503 },
      );
    }

    const body: unknown = await request.json();
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return NextResponse.json({ message: "Sandbox payment details are invalid." }, { status: 400 });
    }
    const input = body as Record<string, unknown>;
    const phoneNumber =
      typeof input.phoneNumber === "string" ? normalizeKenyanPhoneNumber(input.phoneNumber) : null;
    if (
      !phoneNumber ||
      typeof input.amount !== "number" ||
      !Number.isSafeInteger(input.amount) ||
      input.amount < 1 ||
      input.amount > 150000 ||
      typeof input.idempotencyKey !== "string" ||
      !/^[a-zA-Z0-9_-]{16,64}$/.test(input.idempotencyKey)
    ) {
      return NextResponse.json(
        { message: "Enter a valid Kenyan mobile number, whole KES amount (1–150,000), and unique request key." },
        { status: 400 },
      );
    }

    const created = await createMpesaPaymentAttempt({
      branch: user.branch,
      userId: user.id,
      idempotencyKey: input.idempotencyKey,
      phoneNumber,
      amount: input.amount,
    });
    attemptId = created.attempt.id;
    if (!created.created) {
      return NextResponse.json({
        attempt: publicAttempt(created.attempt),
        message: "This request key already exists; no second STK prompt was sent.",
      });
    }

    let providerResult: Awaited<ReturnType<typeof initiateSandboxStkPush>>;
    try {
      providerResult = await initiateSandboxStkPush({ attempt: created.attempt });
    } catch (error) {
      await updateMpesaPaymentSubmission({
        id: created.attempt.id,
        status: "failed",
        resultDescription:
          error instanceof Error ? error.message : "Daraja authentication or request setup failed.",
      });
      return NextResponse.json(
        { message: "The sandbox STK request could not be started. Check server configuration and logs." },
        { status: 502 },
      );
    }

    const attempt = await updateMpesaPaymentSubmission({
      id: created.attempt.id,
      status: providerResult.status,
      merchantRequestId: providerResult.merchantRequestId,
      checkoutRequestId: providerResult.checkoutRequestId,
      resultCode: providerResult.resultCode,
      resultDescription: providerResult.resultDescription,
    });
    return NextResponse.json({
      attempt: publicAttempt(attempt),
      message:
        attempt.status === "pending"
          ? "STK request accepted. This is not a completed sale or proof of payment."
          : attempt.status === "unknown"
            ? "The provider request outcome is unknown; verify this attempt before creating another."
            : "Daraja rejected the sandbox STK request.",
    }, { status: attempt.status === "pending" ? 202 : 502 });
  } catch (error) {
    const statusCode =
      typeof error === "object" && error !== null && "statusCode" in error
        ? Number(error.statusCode)
        : 500;
    if (statusCode === 409) {
      return NextResponse.json(
        { message: error instanceof Error ? error.message : "Idempotency key conflict." },
        { status: 409 },
      );
    }
    if (attemptId) {
      try {
        await updateMpesaPaymentSubmission({
          id: attemptId,
          status: "unknown",
          resultDescription: "The application could not determine the STK request outcome.",
        });
      } catch (updateError) {
        console.error("Unable to record uncertain M-Pesa submission:", updateError);
      }
    }
    console.error("Unable to initiate M-Pesa sandbox payment:", error);
    return NextResponse.json(
      { message: "Unable to initiate the sandbox payment. Check the attempt status before retrying." },
      { status: 500 },
    );
  }
}
