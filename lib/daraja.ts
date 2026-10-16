import type { MpesaPaymentAttempt } from "./store";

const SANDBOX_BASE_URL = "https://sandbox.safaricom.co.ke";

type DarajaConfig = {
  consumerKey: string;
  consumerSecret: string;
  shortcode: string;
  passkey: string;
  callbackUrl: string;
};

type DarajaResponse = Record<string, unknown>;

function getConfig(): DarajaConfig {
  const {
    DARAJA_ENV,
    DARAJA_CONSUMER_KEY,
    DARAJA_CONSUMER_SECRET,
    DARAJA_SHORTCODE,
    DARAJA_PASSKEY,
    DARAJA_CALLBACK_URL,
  } = process.env;
  if (DARAJA_ENV !== "sandbox") {
    throw new Error("M-Pesa testing is disabled unless DARAJA_ENV is set to sandbox.");
  }
  if (
    !DARAJA_CONSUMER_KEY ||
    !DARAJA_CONSUMER_SECRET ||
    !DARAJA_SHORTCODE ||
    !DARAJA_PASSKEY ||
    !DARAJA_CALLBACK_URL
  ) {
    throw new Error("Complete the server-side Daraja sandbox environment configuration.");
  }
  if (!/^\d{5,7}$/.test(DARAJA_SHORTCODE)) {
    throw new Error("DARAJA_SHORTCODE must contain 5 to 7 digits.");
  }
  const callback = new URL(DARAJA_CALLBACK_URL);
  if (
    callback.protocol !== "https:" ||
    callback.hostname === "localhost" ||
    callback.hostname.endsWith(".localhost") ||
    callback.pathname !== "/api/payments/mpesa/callback" ||
    callback.username ||
    callback.password ||
    callback.search ||
    callback.hash
  ) {
    throw new Error(
      "DARAJA_CALLBACK_URL must be the public HTTPS /api/payments/mpesa/callback endpoint without query parameters.",
    );
  }
  return {
    consumerKey: DARAJA_CONSUMER_KEY,
    consumerSecret: DARAJA_CONSUMER_SECRET,
    shortcode: DARAJA_SHORTCODE,
    passkey: DARAJA_PASSKEY,
    callbackUrl: callback.toString(),
  };
}

export function assertSandboxDarajaConfigured(): void {
  getConfig();
}

function darajaTimestamp(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}${values.month}${values.day}${values.hour}${values.minute}${values.second}`;
}

function requestPassword(shortcode: string, passkey: string, timestamp: string): string {
  return Buffer.from(`${shortcode}${passkey}${timestamp}`).toString("base64");
}

async function readDarajaResponse(response: Response): Promise<DarajaResponse> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`Daraja returned an unreadable response (HTTP ${response.status}).`);
  }
  if (!response.ok || typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new Error(`Daraja request failed (HTTP ${response.status}).`);
  }
  return payload as DarajaResponse;
}

async function getAccessToken(config: DarajaConfig): Promise<string> {
  const credentials = Buffer.from(`${config.consumerKey}:${config.consumerSecret}`).toString("base64");
  const response = await fetch(
    `${SANDBOX_BASE_URL}/oauth/v1/generate?grant_type=client_credentials`,
    {
      headers: { Authorization: `Basic ${credentials}` },
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    },
  );
  const payload = await readDarajaResponse(response);
  if (typeof payload.access_token !== "string" || !payload.access_token) {
    throw new Error("Daraja did not return an access token.");
  }
  return payload.access_token;
}

async function postDaraja(
  path: string,
  accessToken: string,
  body: Record<string, string | number>,
): Promise<DarajaResponse> {
  const response = await fetch(`${SANDBOX_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(20000),
  });
  return readDarajaResponse(response);
}

export function normalizeKenyanPhoneNumber(value: string): string | null {
  const compact = value.replace(/[\s()-]/g, "");
  const normalized = compact.startsWith("+")
    ? compact.slice(1)
    : compact.startsWith("0")
      ? `254${compact.slice(1)}`
      : compact;
  return /^254(?:7|1)\d{8}$/.test(normalized) ? normalized : null;
}

export async function initiateSandboxStkPush(input: {
  attempt: MpesaPaymentAttempt;
}): Promise<{
  status: "pending" | "failed" | "unknown";
  merchantRequestId: string | null;
  checkoutRequestId: string | null;
  resultCode: string | null;
  resultDescription: string;
}> {
  const config = getConfig();
  const accessToken = await getAccessToken(config);
  const timestamp = darajaTimestamp();
  let payload: DarajaResponse;
  try {
    payload = await postDaraja("/mpesa/stkpush/v1/processrequest", accessToken, {
      BusinessShortCode: config.shortcode,
      Password: requestPassword(config.shortcode, config.passkey, timestamp),
      Timestamp: timestamp,
      TransactionType: "CustomerPayBillOnline",
      Amount: input.attempt.amount,
      PartyA: input.attempt.phoneNumber,
      PartyB: config.shortcode,
      PhoneNumber: input.attempt.phoneNumber,
      CallBackURL: config.callbackUrl,
      AccountReference: `POS-${input.attempt.id.slice(0, 12)}`,
      TransactionDesc: "Sandbox POS payment test",
    });
  } catch (error) {
    return {
      status: "unknown",
      merchantRequestId: null,
      checkoutRequestId: null,
      resultCode: null,
      resultDescription: error instanceof Error ? error.message : "Daraja request outcome is unknown.",
    };
  }

  const merchantRequestId =
    typeof payload.MerchantRequestID === "string" ? payload.MerchantRequestID : null;
  const checkoutRequestId =
    typeof payload.CheckoutRequestID === "string" ? payload.CheckoutRequestID : null;
  const resultCode =
    typeof payload.ResponseCode === "string" ? payload.ResponseCode : null;
  const resultDescription =
    typeof payload.ResponseDescription === "string"
      ? payload.ResponseDescription
      : typeof payload.CustomerMessage === "string"
        ? payload.CustomerMessage
        : "Daraja returned no request description.";
  const accepted = resultCode === "0" && merchantRequestId !== null && checkoutRequestId !== null;
  return {
    status: accepted ? "pending" : resultCode === null ? "unknown" : "failed",
    merchantRequestId,
    checkoutRequestId,
    resultCode,
    resultDescription,
  };
}

export async function querySandboxStkPush(attempt: MpesaPaymentAttempt): Promise<{
  checkoutRequestId: string;
  resultCode: string | null;
  resultDescription: string;
}> {
  const config = getConfig();
  if (!attempt.checkoutRequestId) {
    throw new Error("This M-Pesa attempt has no provider checkout reference to query.");
  }
  const accessToken = await getAccessToken(config);
  const timestamp = darajaTimestamp();
  const payload = await postDaraja("/mpesa/stkpushquery/v1/query", accessToken, {
    BusinessShortCode: config.shortcode,
    Password: requestPassword(config.shortcode, config.passkey, timestamp),
    Timestamp: timestamp,
    CheckoutRequestID: attempt.checkoutRequestId,
  });
  const checkoutRequestId =
    typeof payload.CheckoutRequestID === "string" ? payload.CheckoutRequestID : "";
  const resultCode =
    typeof payload.ResultCode === "string" || typeof payload.ResultCode === "number"
      ? String(payload.ResultCode)
      : null;
  const resultDescription =
    typeof payload.ResultDesc === "string"
      ? payload.ResultDesc
      : typeof payload.ResponseDescription === "string"
        ? payload.ResponseDescription
        : "Daraja returned no query description.";
  if (!checkoutRequestId || checkoutRequestId !== attempt.checkoutRequestId) {
    throw new Error("Daraja's query response did not contain a matching checkout reference.");
  }
  return { checkoutRequestId, resultCode, resultDescription };
}
