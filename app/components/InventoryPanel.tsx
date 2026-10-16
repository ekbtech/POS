"use client";

import { FormEvent, useEffect, useState } from "react";

export type Product = {
  id: number;
  name: string;
  barcode: string | null;
  category: string;
  price: number;
  stock: number;
  reorderLevel: number;
  stockCounted: boolean;
};

type StockMovement = {
  id: number;
  productName: string;
  cashierName: string;
  movement: string;
  quantityDelta: number;
  quantityAfter: number;
  reason: string;
  createdAt: string;
};

const currency = (amount: number) =>
  new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);

export default function InventoryPanel({
  branch,
  products,
  onChanged,
}: {
  branch: string;
  products: Product[];
  onChanged: () => Promise<void>;
}) {
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState({ name: "", barcode: "", category: "", price: "" });
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [movements, setMovements] = useState<StockMovement[]>([]);

  const startEdit = (product: Product) => {
    setEditingId(product.id);
    setForm({
      name: product.name,
      barcode: product.barcode ?? "",
      category: product.category,
      price: String(product.price),
    });
  };

  const reset = () => {
    setEditingId(null);
    setForm({ name: "", barcode: "", category: "", price: "" });
  };

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch(editingId ? `/api/products/${editingId}` : "/api/products", {
        method: editingId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          barcode: form.barcode,
          category: form.category,
          price: Number(form.price),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Unable to save product.");
      setMessage(editingId ? "Product updated." : "Product added.");
      reset();
      await onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to save product.");
    } finally {
      setSaving(false);
    }
  };

  const loadMovements = async () => {
    const response = await fetch(`/api/inventory?branch=${encodeURIComponent(branch)}`, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || "Unable to load inventory movements.");
    setMovements(data.movements ?? []);
  };

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const response = await fetch(`/api/inventory?branch=${encodeURIComponent(branch)}`, { cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || "Unable to load inventory movements.");
        if (active) setMovements(data.movements ?? []);
      } catch (error) {
        if (active) {
          setMessage(error instanceof Error ? error.message : "Unable to load inventory movements.");
        }
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [branch]);

  return (
    <section className="space-y-5">
      <div className="rounded-3xl border border-slate-800 bg-slate-900/80 p-5">
        <h2 className="text-xl font-semibold">{editingId ? "Update product details" : "Add product"}</h2>
        <p className="mt-1 text-sm text-slate-500">Catalog details are shared across branches. Stock counts and reorder levels are branch-specific and audited below.</p>
        <form onSubmit={save} className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <input required maxLength={180} placeholder="Product name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2" />
          <input maxLength={64} placeholder="Barcode (optional)" value={form.barcode} onChange={(e) => setForm({ ...form, barcode: e.target.value })} className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2" />
          <input required maxLength={100} placeholder="Category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2" />
          <input required min="0" step="0.01" type="number" placeholder="Price (KES)" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2" />
          <div className="flex gap-2 sm:col-span-2 lg:col-span-4">
            <button disabled={saving} className="rounded-xl bg-sky-600 px-4 py-2 font-semibold text-white disabled:opacity-60">
              {saving ? "Saving..." : editingId ? "Save changes" : "Add to inventory"}
            </button>
            {editingId ? <button type="button" onClick={reset} className="rounded-xl border border-slate-700 px-4 py-2">Cancel</button> : null}
            {message ? <p role="status" className="self-center text-sm text-slate-300">{message}</p> : null}
          </div>
        </form>
      </div>

      <div className="overflow-hidden rounded-3xl border border-slate-800 bg-slate-900/80">
        <div className="border-b border-slate-800 p-5">
          <h2 className="text-xl font-semibold">Inventory ({products.length})</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1040px] text-left text-sm">
            <thead className="bg-slate-950/70 text-slate-400">
              <tr><th className="p-4">Product</th><th className="p-4">Barcode</th><th className="p-4">Category</th><th className="p-4">Price</th><th className="p-4">On hand</th><th className="p-4">Reorder at</th><th className="p-4">Stock movement</th><th className="p-4">Action</th></tr>
            </thead>
            <tbody>
              {products.map((product) => (
                <tr key={product.id} className="border-t border-slate-800">
                  <td className="p-4 font-medium">{product.name}</td>
                  <td className="p-4 font-mono text-xs text-slate-400">{product.barcode || "—"}</td>
                  <td className="p-4 text-slate-400">{product.category}</td>
                  <td className="p-4">{currency(product.price)}</td>
                  <td className={`p-4 ${!product.stockCounted || product.stock <= product.reorderLevel ? "text-amber-700" : ""}`}>{product.stockCounted ? product.stock : "Count required"}</td>
                  <td className="p-4 text-slate-400">{product.stockCounted ? product.reorderLevel : "—"}</td>
                  <td className="p-4">
                    <StockMovementForm
                      key={`${product.id}-${product.stockCounted}-${product.reorderLevel}`}
                      branch={branch}
                      product={product}
                      onChanged={async () => {
                        await onChanged();
                        await loadMovements();
                      }}
                    />
                  </td>
                  <td className="p-4"><button onClick={() => startEdit(product)} className="rounded-lg border border-slate-700 px-3 py-1.5 hover:border-sky-500">Edit</button></td>
                </tr>
              ))}
              {products.length === 0 ? <tr><td colSpan={8} className="p-8 text-center text-slate-400">No inventory items found.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </div>
      <div className="overflow-hidden rounded-3xl border border-slate-800 bg-slate-900/80">
        <div className="border-b border-slate-800 p-5"><h2 className="text-xl font-semibold">Recent stock movements · {branch}</h2></div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-slate-950/70 text-slate-400"><tr><th className="p-4">Time</th><th className="p-4">Product</th><th className="p-4">Movement</th><th className="p-4">Change</th><th className="p-4">On hand</th><th className="p-4">Staff</th><th className="p-4">Reason</th></tr></thead>
            <tbody>
              {movements.map((movement) => (
                <tr key={movement.id} className="border-t border-slate-800">
                  <td className="p-4 text-slate-400">{new Date(movement.createdAt).toLocaleString()}</td>
                  <td className="p-4 font-medium">{movement.productName}</td>
                  <td className="p-4 capitalize">{movement.movement}</td>
                  <td className="p-4">{movement.quantityDelta > 0 ? "+" : ""}{movement.quantityDelta}</td>
                  <td className="p-4">{movement.quantityAfter}</td>
                  <td className="p-4">{movement.cashierName}</td>
                  <td className="p-4 text-slate-400">{movement.reason}</td>
                </tr>
              ))}
              {movements.length === 0 ? <tr><td colSpan={7} className="p-8 text-center text-slate-400">No audited stock movements recorded for this branch.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function StockMovementForm({
  branch,
  product,
  onChanged,
}: {
  branch: string;
  product: Product;
  onChanged: () => Promise<void>;
}) {
  const [movement, setMovement] = useState(product.stockCounted ? "receipt" : "opening");
  const [quantity, setQuantity] = useState(product.stockCounted ? "1" : "0");
  const [reorderLevel, setReorderLevel] = useState(String(product.reorderLevel));
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const isOpening = !product.stockCounted;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branch,
          productId: product.id,
          movement,
          quantity: Number(quantity),
          reorderLevel: Number(reorderLevel),
          reason,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Unable to record stock movement.");
      setReason("");
      if (movement === "receipt") setQuantity("1");
      setMessage("Recorded");
      await onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to record stock movement.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="grid min-w-[320px] grid-cols-2 gap-2">
      {!product.stockCounted ? (
        <span className="col-span-2 text-xs font-medium text-amber-700">Physical count required before this item can be sold.</span>
      ) : null}
      <select
        value={movement}
        disabled={isOpening}
        onChange={(event) => {
          setMovement(event.target.value);
          setQuantity(event.target.value === "receipt" ? "1" : "");
        }}
        aria-label={`Movement type for ${product.name}`}
        className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs"
      >
        {isOpening ? <option value="opening">Verified opening count</option> : null}
        <option value="receipt">Receive stock (+)</option>
        <option value="adjustment">Adjustment (+/-)</option>
      </select>
      <input
        required
        type="number"
        step="1"
        min={movement === "opening" ? "0" : movement === "receipt" ? "1" : undefined}
        value={quantity}
        onChange={(event) => setQuantity(event.target.value)}
        aria-label={`Quantity for ${product.name}`}
        placeholder={movement === "opening" ? "Counted units" : "Quantity / delta"}
        className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs"
      />
      <input
        required
        type="number"
        min="0"
        step="1"
        value={reorderLevel}
        onChange={(event) => setReorderLevel(event.target.value)}
        aria-label={`Reorder level for ${product.name}`}
        placeholder="Reorder at"
        className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs"
      />
      <input
        required
        minLength={3}
        maxLength={240}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        aria-label={`Reason for ${product.name} stock movement`}
        placeholder={movement === "opening" ? "Count reference / reason" : "Reason or delivery reference"}
        className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs"
      />
      <button disabled={saving} className="col-span-2 rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60">
        {saving ? "Saving..." : movement === "opening" ? "Record verified count" : "Record movement"}
      </button>
      {message ? <p role="status" className="col-span-2 text-xs text-slate-500">{message}</p> : null}
    </form>
  );
}
