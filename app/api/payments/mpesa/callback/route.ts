import { NextRequest, NextResponse } from "next/server";

import { recordMpesaPaymentCallback } from "../../../../../lib/store";
import { normalizeKenyanPhoneNumber } from "../../../../../lib/daraja";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readMetadata(items: unknown[]) {
  const metadata = new Map<string, unknown>();
  for (const item of items) {
    if (isRecord(item) && typeof item.Name === "string") {
      metadata.set(item.Name, item.Value);
    }
  }
  const amount = metadata.get("Amount");
  const phoneValue = metadata.get("PhoneNumber");
  const receiptValue = metadata.get("MpesaReceiptNumber");
  const numericAmount =
    typeof amount === "number" || (typeof amount === "string" && amount.trim() !== "")
      ? Number(amount)
      : null;
  return {
    amount: numericAmount !== null && Number.isSafeInteger(numericAmount) ? numericAmount : null,
    phoneNumber:
      typeof phoneValue === "string" || typeof phoneValue === "number"
        ? normalizeKenyanPhoneNumber(String(phoneValue))
        : null,
    receiptNumber: typeof receiptValue === "string" ? receiptValue : null,
  };
}

export async function POST(request: NextRequest) {
  try {
    const body: unknown = await request.json();
    if (
      !isRecord(body) ||
      !isRecord(body.Body) ||
      !isRecord(body.Body.stkCallback)
    ) {
      return NextResponse.json({ message: "Invalid Daraja callback payload." }, { status: 400 });
    }
    const callback = body.Body.stkCallback;
    const merchantRequestId = callback.MerchantRequestID;
    const checkoutRequestId = callback.CheckoutRequestID;
    const rawResultCode = callback.ResultCode;
    if (
      typeof merchantRequestId !== "string" ||
      merchantRequestId.length > 64 ||
      typeof checkoutRequestId !== "string" ||
      checkoutRequestId.length > 64 ||
      !(typeof rawResultCode === "number" || typeof rawResultCode === "string")
    ) {
      return NextResponse.json({ message: "Daraja callback references are invalid." }, { status: 400 });
    }
    const resultCode = String(rawResultCode);
    const metadata = isRecord(callback.CallbackMetadata) && Array.isArray(callback.CallbackMetadata.Item)
      ? readMetadata(callback.CallbackMetadata.Item)
      : { amount: null, phoneNumber: null, receiptNumber: null };
    const recorded = await recordMpesaPaymentCallback({
      merchantRequestId,
      checkoutRequestId,
      resultCode,
      resultDescription:
        typeof callback.ResultDesc === "string" ? callback.ResultDesc : "Daraja callback received.",
      ...metadata,
    });
    if (!recorded) {
      console.warn("Received Daraja callback with no matching stored payment attempt.");
    }
    return NextResponse.json({ ResultCode: 0, ResultDesc: "Callback received." });
  } catch (error) {
    console.error("Unable to process Daraja callback:", error);
    return NextResponse.json({ message: "Unable to process Daraja callback." }, { status: 500 });
  }
}
