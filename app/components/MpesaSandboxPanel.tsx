"use client";

import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";

type Attempt = {
  id: string;
  branch: string;
  phoneNumber: string;
  amount: number;
  status: string;
  resultCode: string | null;
  resultDescription: string | null;
  mpesaReceiptNumber: string | null;
  canQuery: boolean;
  createdAt: string;
  updatedAt: string;
};

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    maximumFractionDigits: 0,
  }).format(amount);

export default function MpesaSandboxPanel({ compact = false }: { compact?: boolean }) {
  const [phoneNumber, setPhoneNumber] = useState("");
  const [amount, setAmount] = useState("");
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [environment, setEnvironment] = useState<"sandbox" | "disabled">("disabled");
  const [configurationMessage, setConfigurationMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const fetchAttempts = useCallback(async () => {
    const response = await fetch("/api/payments/mpesa", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || "Unable to load M-Pesa attempts.");
    return data;
  }, []);

  const loadAttempts = useCallback(async () => {
    const data = await fetchAttempts();
    setAttempts(data.attempts ?? []);
    setEnvironment(data.environment === "sandbox" ? "sandbox" : "disabled");
    setConfigurationMessage(data.configurationMessage ?? "");
  }, [fetchAttempts]);

  useEffect(() => {
    let active = true;
    const initialize = async () => {
      try {
        const data = await fetchAttempts();
        if (!active) return;
        setAttempts(data.attempts ?? []);
        setEnvironment(data.environment === "sandbox" ? "sandbox" : "disabled");
        setConfigurationMessage(data.configurationMessage ?? "");
      } catch (loadError) {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "Unable to load M-Pesa attempts.");
        }
      } finally {
        if (active) setLoading(false);
      }
    };
    void initialize();
    return () => {
      active = false;
    };
  }, [fetchAttempts]);

  const submitPayment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusyId("new");
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/payments/mpesa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phoneNumber,
          amount: Number(amount),
          idempotencyKey: crypto.randomUUID(),
        }),
      });
      const data = await response.json();
      if (!response.ok && response.status !== 202) {
        throw new Error(data.message || "Unable to send sandbox STK prompt.");
      }
      setNotice(data.message || "Sandbox STK request submitted.");
      setPhoneNumber("");
      setAmount("");
      await loadAttempts();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to send sandbox STK prompt.");
      try {
        await loadAttempts();
      } catch (refreshError) {
        setError(
          `${submitError instanceof Error ? submitError.message : "Unable to send sandbox STK prompt."} ` +
          `Attempt list refresh failed: ${refreshError instanceof Error ? refreshError.message : "unknown error."}`,
        );
      }
    } finally {
      setBusyId("");
    }
  };

  const verifyAttempt = async (id: string) => {
    setBusyId(id);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/payments/mpesa/${encodeURIComponent(id)}/verify`, {
        method: "POST",
      });
      const data = await response.json();
      if (!response.ok && response.status !== 202) {
        throw new Error(data.message || "Unable to verify this sandbox attempt.");
      }
      setNotice(data.message || "Daraja status query completed.");
      await loadAttempts();
    } catch (verifyError) {
      setError(verifyError instanceof Error ? verifyError.message : "Unable to verify this sandbox attempt.");
    } finally {
      setBusyId("");
    }
  };

  return (
    <section className={compact ? "space-y-3" : "space-y-5"}>
      <div role="alert" className={`rounded-xl border border-amber-300 bg-amber-50 ${compact ? "p-3 text-xs" : "rounded-2xl p-4 text-sm"} text-amber-950`}>
        <p className="font-semibold">{compact ? "Sandbox test only — not a sale." : "Sandbox testing only — not checkout."}</p>
        <p className="mt-1">
          {compact
            ? "Use a Daraja test phone only. This prompt will not charge, record a sale, or change stock."
            : "These standalone payment attempts never create a sale, reserve stock, or issue a receipt. Do not use real customer payments here."}
        </p>
        {environment !== "sandbox" && configurationMessage ? (
          <p className="mt-2">{configurationMessage}</p>
        ) : null}
      </div>

      <div className={`rounded-2xl border border-slate-800 bg-slate-900/80 ${compact ? "p-3" : "rounded-3xl p-5"}`}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className={`font-semibold ${compact ? "text-sm" : "text-lg"}`}>Safaricom Daraja STK Push</h2>
          <span className={`rounded-full px-3 py-1 text-xs font-bold uppercase ${environment === "sandbox" ? "bg-emerald-500/10 text-emerald-300" : "bg-rose-500/10 text-rose-300"}`}>
            {environment}
          </span>
        </div>
        <form onSubmit={submitPayment} className={`grid gap-3 ${compact ? "grid-cols-1" : "sm:grid-cols-[1fr_10rem_auto]"}`}>
          <label className="text-sm text-slate-300">
            Sandbox phone number
            <input
              required
              autoComplete="off"
              inputMode="tel"
              value={phoneNumber}
              onChange={(event) => setPhoneNumber(event.target.value)}
              placeholder="07xx xxx xxx"
              className="mt-1 block w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-white"
            />
          </label>
          <label className="text-sm text-slate-300">
            Test amount (KES)
            <input
              required
              type="number"
              min="1"
              max="150000"
              step="1"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              className="mt-1 block w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-white"
            />
          </label>
          <button
            disabled={busyId !== "" || environment !== "sandbox"}
            className="self-end rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busyId === "new" ? "Sending..." : "Send test prompt"}
          </button>
        </form>
        {error ? <p role="alert" className="mt-3 text-sm text-rose-300">{error}</p> : null}
        {notice ? <p role="status" className="mt-3 text-sm text-emerald-300">{notice}</p> : null}
      </div>

      {!compact || attempts.length > 0 ? <div className={`rounded-2xl border border-slate-800 bg-slate-900/80 ${compact ? "p-3" : "rounded-3xl p-5"}`}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{compact ? "Latest test attempt" : "Recent test attempts"}</h2>
          <button
            onClick={() => void loadAttempts().catch((loadError: unknown) => setError(loadError instanceof Error ? loadError.message : "Unable to refresh attempts."))}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300"
          >
            Refresh
          </button>
        </div>
        {loading ? <p className="text-sm text-slate-400">Loading attempts...</p> : null}
        {!loading && attempts.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-700 p-4 text-sm text-slate-400">No sandbox attempts have been created.</p>
        ) : null}
        <div className="space-y-3">
          {(compact ? attempts.slice(0, 1) : attempts).map((attempt) => (
            <article key={attempt.id} className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
              <div className="min-w-56">
                <p className="font-semibold">{formatCurrency(attempt.amount)} · {attempt.phoneNumber}</p>
                <p className="mt-1 text-xs text-slate-400">{attempt.branch} · {new Date(attempt.createdAt).toLocaleString()}</p>
                <p className="mt-1 text-xs text-slate-300">Status: <span className="font-semibold">{attempt.status.replace(/_/g, " ")}</span></p>
                {attempt.resultDescription ? <p className="mt-1 max-w-xl text-xs text-slate-400">{attempt.resultDescription}</p> : null}
                {attempt.mpesaReceiptNumber ? <p className="mt-1 text-xs text-emerald-300">Provider receipt: {attempt.mpesaReceiptNumber}</p> : null}
              </div>
              {attempt.canQuery && attempt.status !== "confirmed" && attempt.status !== "failed" ? (
                <button
                  disabled={busyId !== ""}
                  onClick={() => void verifyAttempt(attempt.id)}
                  className="rounded-lg border border-sky-700 px-3 py-2 text-xs font-semibold text-sky-200 disabled:opacity-50"
                >
                  {busyId === attempt.id ? "Checking..." : "Query Daraja status"}
                </button>
              ) : null}
            </article>
          ))}
        </div>
      </div> : null}
    </section>
  );
}
