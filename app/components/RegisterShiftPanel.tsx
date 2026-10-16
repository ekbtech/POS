"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Shift = {
  id: string;
  openedByName: string;
  openingCash: number;
  openedAt: string;
  expectedCash: number;
};

type Register = {
  id: string;
  branch: string;
  name: string;
  openShift: Shift | null;
  lastClosedCash: number | null;
};
type AuditEvent = {
  id: number;
  type: "opened" | "closed";
  actor: string;
  cashCount: number;
  expectedCash: number | null;
  variance: number | null;
  reason: string | null;
  createdAt: string;
};
type ApprovalAudit = {
  id: string;
  action: "cart_item_void" | "basket_discount";
  operatorName: string;
  approverName: string;
  reason: string;
  details: Record<string, unknown>;
  usedTransactionId: string | null;
  createdAt: string;
};

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);

export default function RegisterShiftPanel({
  branch,
  canManageRegisters,
  onShiftChange,
}: {
  branch: string;
  canManageRegisters: boolean;
  onShiftChange: (registerId: string | null, shiftId: string | null) => void;
}) {
  const [registers, setRegisters] = useState<Register[]>([]);
  const [history, setHistory] = useState<AuditEvent[]>([]);
  const [approvalHistory, setApprovalHistory] = useState<ApprovalAudit[]>([]);
  const [selectedRegisterId, setSelectedRegisterId] = useState("");
  const [openingCash, setOpeningCash] = useState("0.00");
  const [closingCash, setClosingCash] = useState("0.00");
  const [reason, setReason] = useState("");
  const [newRegisterName, setNewRegisterName] = useState("");
  const [loadedBranch, setLoadedBranch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const selectedRegister = useMemo(
    () => registers.find((register) => register.id === selectedRegisterId) ?? null,
    [registers, selectedRegisterId],
  );

  const loadRegisterHistory = useCallback(async (registerId: string) => {
    const urls = [
      `/api/shifts?branch=${encodeURIComponent(branch)}&registerId=${encodeURIComponent(registerId)}`,
      `/api/pos/approvals?branch=${encodeURIComponent(branch)}&registerId=${encodeURIComponent(registerId)}`,
    ];
    const [shiftResponse, approvalResponse] = await Promise.all(
      urls.map((url) => fetch(url, { cache: "no-store" })),
    );
    const [shiftData, approvalData] = await Promise.all([
      shiftResponse.json(),
      approvalResponse.json(),
    ]);
    if (!shiftResponse.ok) throw new Error(shiftData.message || "Unable to load shift history.");
    if (!approvalResponse.ok) throw new Error(approvalData.message || "Unable to load approval history.");
    setHistory(shiftData.history ?? []);
    setApprovalHistory(approvalData.history ?? []);
  }, [branch]);

  const loadRegisters = useCallback(async () => {
    const response = await fetch(`/api/registers?branch=${encodeURIComponent(branch)}`, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || "Unable to load registers.");
    const nextRegisters: Register[] = data.registers ?? [];
    setRegisters(nextRegisters);
    const selected = nextRegisters.find((register) => register.id === selectedRegisterId)
      ?? nextRegisters[0]
      ?? null;
    setSelectedRegisterId(
      selected?.id ?? "",
    );
    if (selected) {
      setOpeningCash((selected.lastClosedCash ?? 0).toFixed(2));
      setClosingCash((selected.openShift?.expectedCash ?? 0).toFixed(2));
      await loadRegisterHistory(selected.id);
    } else {
      setHistory([]);
      setApprovalHistory([]);
    }
    setLoadedBranch(branch);
  }, [branch, loadRegisterHistory, selectedRegisterId]);

  useEffect(() => {
    let active = true;
    fetch(`/api/registers?branch=${encodeURIComponent(branch)}`, { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || "Unable to load registers.");
        if (!active) return;
        const nextRegisters: Register[] = data.registers ?? [];
        setRegisters(nextRegisters);
        const selected = nextRegisters[0] ?? null;
        setSelectedRegisterId(selected?.id ?? "");
        if (selected) {
          setOpeningCash((selected.lastClosedCash ?? 0).toFixed(2));
          setClosingCash((selected.openShift?.expectedCash ?? 0).toFixed(2));
          await loadRegisterHistory(selected.id);
        } else {
          setHistory([]);
          setApprovalHistory([]);
        }
        setError("");
      })
      .catch((loadError: unknown) => {
        if (active) setError(loadError instanceof Error ? loadError.message : "Unable to load registers.");
      })
      .finally(() => {
        if (active) setLoadedBranch(branch);
      });
    return () => {
      active = false;
    };
  }, [branch, loadRegisterHistory]);

  useEffect(() => {
    const register = loadedBranch === branch ? selectedRegister : null;
    onShiftChange(register?.id ?? null, register?.openShift?.id ?? null);
  }, [branch, loadedBranch, onShiftChange, selectedRegister]);

  const performShiftAction = async (action: "open" | "close") => {
    if (!selectedRegister) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const amount = Number(action === "open" ? openingCash : closingCash);
      const response = await fetch("/api/shifts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          branch,
          registerId: selectedRegister.id,
          openingCash: action === "open" ? amount : undefined,
          closingCash: action === "close" ? amount : undefined,
          reason,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Unable to update register shift.");
      setNotice(
        action === "open"
          ? "Shift opened. Count and record the till again at handover."
          : `Shift closed. Expected ${formatCurrency(data.shift.expectedCash)}; counted ${formatCurrency(data.shift.closingCash)}.`,
      );
      setReason("");
      try {
        await loadRegisters();
      } catch (refreshError) {
        setError(
          `Shift ${action === "open" ? "opened" : "closed"}, but register refresh failed: ` +
          `${refreshError instanceof Error ? refreshError.message : "unknown error."}`,
        );
      }
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Unable to update register shift.");
      try {
        await loadRegisters();
      } catch (refreshError) {
        setError(
          `${actionError instanceof Error ? actionError.message : "Unable to update register shift."} ` +
          `Register refresh failed: ${refreshError instanceof Error ? refreshError.message : "unknown error."}`,
        );
      }
    } finally {
      setBusy(false);
    }
  };

  const addRegister = async () => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/registers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branch, name: newRegisterName }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Unable to add register.");
      setNotice(`${data.register.name} added.`);
      setNewRegisterName("");
      try {
        await loadRegisters();
      } catch (refreshError) {
        setError(
          `Register added, but refresh failed: ${refreshError instanceof Error ? refreshError.message : "unknown error."}`,
        );
      }
      setSelectedRegisterId(data.register.id);
      try {
        await loadRegisterHistory(data.register.id);
      } catch (historyError) {
        setError(
          `Register added, but audit history could not be loaded: ${historyError instanceof Error ? historyError.message : "unknown error."}`,
        );
      }
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Unable to add register.");
    } finally {
      setBusy(false);
    }
  };
  const loading = loadedBranch !== branch;

  return (
    <section className="space-y-3 rounded-2xl border border-slate-700 bg-slate-900 p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-white">Register & shift</h2>
          <p className="mt-0.5 text-xs text-slate-400">Shared till · opening float, handover count, and cash reconciliation</p>
        </div>
        {registers.length > 0 ? (
          <label className="flex items-center gap-2 text-xs text-slate-400">
            Till
            <select
              aria-label="Select till"
              value={selectedRegisterId}
              onChange={(event) => {
                const nextId = event.target.value;
                const next = registers.find((register) => register.id === nextId);
                setSelectedRegisterId(nextId);
                setOpeningCash((next?.lastClosedCash ?? 0).toFixed(2));
                setClosingCash((next?.openShift?.expectedCash ?? 0).toFixed(2));
                setReason("");
                if (next) void loadRegisterHistory(next.id).catch((loadError: unknown) => setError(loadError instanceof Error ? loadError.message : "Unable to load register audit history."));
              }}
              className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-sm text-white"
            >
              {registers.map((register) => (
                <option key={register.id} value={register.id}>{register.name}</option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      {loading ? <p className="text-xs text-slate-400">Loading registers...</p> : null}
      {!loading && registers.length === 0 ? (
        <p className="rounded-lg border border-amber-800 bg-amber-950/40 p-2.5 text-xs text-amber-200">
          No register is configured for this branch. Ask a manager to add one.
        </p>
      ) : null}

      {selectedRegister?.openShift ? (
        <div className="rounded-lg border border-emerald-800 bg-emerald-950/30 p-2.5 text-xs text-emerald-100">
          <p className="font-semibold">Shift open · {selectedRegister.openShift.openedByName}</p>
          <p className="mt-1 text-emerald-200/80">
            Opened {new Date(selectedRegister.openShift.openedAt).toLocaleString()} · Opening float {formatCurrency(selectedRegister.openShift.openingCash)}
          </p>
          <p className="mt-1 text-emerald-200/80">Expected cash now {formatCurrency(selectedRegister.openShift.expectedCash)}</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_1.4fr_auto]">
            <label className="text-slate-300">
              Cash counted at handover/close
              <input
                aria-label="Cash counted at shift close"
                type="number"
                min="0"
                step="0.01"
                required
                value={closingCash}
                onChange={(event) => setClosingCash(event.target.value)}
                className="mt-1 block w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-white"
              />
            </label>
            <label className="text-slate-300">
              Variance reason (required if different)
              <input
                aria-label="Shift variance reason"
                maxLength={255}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                className="mt-1 block w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-white"
              />
            </label>
            <button
              type="button"
              disabled={busy}
              onClick={() => void performShiftAction("close")}
              className="self-end rounded-lg border border-rose-700 px-3 py-2 font-semibold text-rose-200 disabled:opacity-50"
            >
              {busy ? "Saving..." : "Close & hand over"}
            </button>
          </div>
        </div>
      ) : selectedRegister ? (
        <div className="rounded-lg border border-slate-700 bg-slate-950/50 p-2.5">
          <p className="mb-2 text-xs text-slate-300">
            {selectedRegister.lastClosedCash === null
              ? "Count the opening float before starting this till."
              : `Previous shift handed over ${formatCurrency(selectedRegister.lastClosedCash)}. Count the drawer and enter the actual amount.`}
          </p>
          <div className="grid gap-2 sm:grid-cols-[1fr_1.4fr_auto]">
            <label className="text-xs text-slate-400">
              Opening cash counted
              <input
                aria-label="Opening cash counted"
                type="number"
                min="0"
                step="0.01"
                required
                value={openingCash}
                onChange={(event) => setOpeningCash(event.target.value)}
                className="mt-1 block w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-sm text-white"
              />
            </label>
            <label className="text-xs text-slate-400">
              Difference/variance reason (required if different)
              <input
                aria-label="Opening cash variance reason"
                maxLength={255}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                className="mt-1 block w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-sm text-white"
              />
            </label>
            <button
              type="button"
              disabled={busy}
              onClick={() => void performShiftAction("open")}
              className="self-end rounded-lg bg-emerald-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
            >
              {busy ? "Saving..." : "Open shift"}
            </button>
          </div>
        </div>
      ) : null}

      {canManageRegisters ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void addRegister();
          }}
          className="flex flex-wrap gap-2 border-t border-slate-800 pt-3"
        >
          <label className="sr-only" htmlFor="new-register-name">New register name</label>
          <input
            id="new-register-name"
            maxLength={80}
            required
            value={newRegisterName}
            onChange={(event) => setNewRegisterName(event.target.value)}
            placeholder="Add another register"
            className="min-w-48 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
          />
          <button type="submit" disabled={busy} className="rounded-lg border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-200 disabled:opacity-50">
            Add register
          </button>
        </form>
      ) : null}
      {history.length > 0 ? (
        <details className="border-t border-slate-800 pt-2 text-xs">
          <summary className="cursor-pointer font-semibold text-slate-300">Recent cash handover audit ({history.length})</summary>
          <ol className="mt-2 space-y-2">
            {history.map((event) => (
              <li key={event.id} className="rounded-lg border border-slate-800 bg-slate-950/50 p-2 text-slate-400">
                <span className="font-semibold text-slate-200">{event.type === "opened" ? "Shift opened" : "Shift closed"} by {event.actor}</span>
                <span> · {new Date(event.createdAt).toLocaleString()} · Counted {formatCurrency(event.cashCount)}</span>
                {event.expectedCash !== null ? <span> · Expected {formatCurrency(event.expectedCash)}</span> : null}
                {event.variance !== null && event.variance !== 0 ? <span> · Variance {formatCurrency(event.variance)}</span> : null}
                {event.reason ? <span> · Reason: {event.reason}</span> : null}
              </li>
            ))}
          </ol>
        </details>
      ) : null}
      {approvalHistory.length > 0 ? (
        <details className="border-t border-slate-800 pt-2 text-xs">
          <summary className="cursor-pointer font-semibold text-slate-300">Manager approval audit ({approvalHistory.length})</summary>
          <ol className="mt-2 space-y-2">
            {approvalHistory.map((approval) => (
              <li key={approval.id} className="rounded-lg border border-slate-800 bg-slate-950/50 p-2 text-slate-400">
                <span className="font-semibold text-slate-200">
                  {approval.action === "basket_discount"
                    ? `${String(approval.details.discountPercent)}% basket discount`
                    : `Cart item void · product ${String(approval.details.productId)}`}
                </span>
                <span> · {approval.operatorName} · approved by {approval.approverName} · {new Date(approval.createdAt).toLocaleString()}</span>
                <span> · Reason: {approval.reason}</span>
                {approval.usedTransactionId ? <span> · Applied to sale {approval.usedTransactionId}</span> : null}
              </li>
            ))}
          </ol>
        </details>
      ) : null}
      {error ? <p role="alert" className="text-xs text-rose-300">{error}</p> : null}
      {notice ? <p role="status" className="text-xs text-emerald-300">{notice}</p> : null}
    </section>
  );
}
