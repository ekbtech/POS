"use client";

import { useEffect, useState } from "react";

type Report = {
  summary: { revenue: number; orders: number; units: number };
  daily: { date: string; revenue: number; orders: number }[];
  topProducts: { name: string; quantity: number; revenue: number }[];
};

const currency = (amount: number) =>
  new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES", maximumFractionDigits: 0 }).format(amount);

const isoDate = (date: Date) => date.toISOString().slice(0, 10);

export default function ReportsPanel({ branch }: { branch?: string }) {
  const today = isoDate(new Date());
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [report, setReport] = useState<Report | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    setMessage("");
    try {
      const params = new URLSearchParams({ from, to });
      if (branch) params.set("branch", branch);
      const response = await fetch(`/api/reports?${params}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Unable to load report.");
      setReport(data.report);
    } catch (error) {
      setReport(null);
      setMessage(error instanceof Error ? error.message : "Unable to load report.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const loadInitial = async () => {
      try {
        const params = new URLSearchParams({ from, to });
        if (branch) params.set("branch", branch);
        const response = await fetch(`/api/reports?${params}`, { cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || "Unable to load report.");
        setReport(data.report);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Unable to load report.");
      } finally {
        setLoading(false);
      }
    };
    void loadInitial();
  }, [from, to, branch]);

  const maxRevenue = Math.max(1, ...(report?.daily.map((day) => day.revenue) ?? []));

  return (
    <section className="space-y-5">
      <div className="flex flex-col gap-3 rounded-3xl border border-slate-800 bg-slate-900/80 p-5 sm:flex-row sm:items-end">
        <label className="grid gap-2 text-sm text-slate-400">From<input type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100" /></label>
        <label className="grid gap-2 text-sm text-slate-400">To<input type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100" /></label>
        <button onClick={() => void load()} disabled={loading} className="rounded-xl bg-sky-600 px-4 py-2 font-semibold text-white disabled:opacity-60">{loading ? "Loading..." : "Refresh report"}</button>
      </div>
      {message ? <p role="alert" className="text-sm text-rose-300">{message}</p> : null}
      {report ? (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            {[["Revenue", currency(report.summary.revenue)], ["Orders", String(report.summary.orders)], ["Units sold", String(report.summary.units)]].map(([label, value]) => (
              <div key={label} className="rounded-3xl border border-slate-800 bg-slate-900/80 p-5"><p className="text-sm text-slate-400">{label}</p><p className="mt-3 text-2xl font-bold">{value}</p></div>
            ))}
          </div>
          <div className="grid gap-5 xl:grid-cols-[1.25fr_0.75fr]">
            <div className="rounded-3xl border border-slate-800 bg-slate-900/80 p-5">
              <h2 className="mb-5 text-xl font-semibold">Daily sales</h2>
              {report.daily.length === 0 ? <p className="text-sm text-slate-400">No sales for this date range.</p> : (
                <div className="space-y-3">
                  {report.daily.map((day) => (
                    <div key={day.date} className="grid grid-cols-[90px_1fr_auto] items-center gap-3 text-sm">
                      <span className="text-slate-400">{day.date}</span>
                      <div className="h-3 overflow-hidden rounded-full bg-slate-800"><div className="h-full rounded-full bg-gradient-to-r from-sky-500 to-indigo-500" style={{ width: `${Math.max(2, (day.revenue / maxRevenue) * 100)}%` }} /></div>
                      <span className="text-right">{currency(day.revenue)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="rounded-3xl border border-slate-800 bg-slate-900/80 p-5">
              <h2 className="mb-5 text-xl font-semibold">Top products</h2>
              <div className="space-y-3">
                {report.topProducts.length ? report.topProducts.map((product, index) => (
                  <div key={product.name} className="flex items-center justify-between gap-3 border-b border-slate-800 pb-3 last:border-0">
                    <div><p className="font-medium">{index + 1}. {product.name}</p><p className="text-xs text-slate-400">{product.quantity} units</p></div>
                    <span className="text-sm text-sky-300">{currency(product.revenue)}</span>
                  </div>
                )) : <p className="text-sm text-slate-400">No product sales in this date range.</p>}
              </div>
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
}
