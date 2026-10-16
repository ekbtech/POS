"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import InventoryPanel, { type Product } from "./components/InventoryPanel";
import MpesaSandboxPanel from "./components/MpesaSandboxPanel";
import RegisterShiftPanel from "./components/RegisterShiftPanel";
import ReportsPanel from "./components/ReportsPanel";
import StaffPanel from "./components/StaffPanel";
import { checkoutReadiness } from "../lib/pos-readiness";

type Role = "admin" | "manager" | "cashier";
type User = {
  id: string;
  name: string;
  email: string;
  role: Role;
  branch: string;
};
type CartItem = { id: number; name: string; price: number; qty: number };
type Transaction = {
  id: string;
  branch: string;
  cashierName: string;
  customer: string;
  paymentMethod: string;
  items: CartItem[];
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  cashTendered: number;
  changeDue: number;
  createdAt: string;
};
type ApprovalRequest =
  | { action: "cart_item_void"; productId: number; itemName: string }
  | { action: "basket_discount"; discountPercent: number; cartSignature: string };
type DiscountApproval = {
  id: string;
  discountPercent: number;
  cartSignature: string;
  approverName: string;
  branch: string;
  registerId: string;
  shiftId: string;
};
type Tab = "pos" | "inventory" | "reports" | "staff" | "mpesa";

const branches = ["Nairobi CBD", "Westlands", "Mombasa", "Kisumu"];
const formatCurrency = (value: number) =>
  new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [activeBranch, setActiveBranch] = useState(branches[0]);
  const [activeTab, setActiveTab] = useState<Tab>("pos");
  const [customerName, setCustomerName] = useState("Walk-in customer");
  const [paymentMethod, setPaymentMethod] = useState("Cash");
  const [cashTendered, setCashTendered] = useState("");
  const [activeRegisterId, setActiveRegisterId] = useState<string | null>(null);
  const [activeShiftId, setActiveShiftId] = useState<string | null>(null);
  const [discountPercent, setDiscountPercent] = useState("");
  const [discountApproval, setDiscountApproval] = useState<DiscountApproval | null>(null);
  const [approvalRequest, setApprovalRequest] = useState<ApprovalRequest | null>(null);
  const [managerEmail, setManagerEmail] = useState("");
  const [managerPassword, setManagerPassword] = useState("");
  const [approvalReason, setApprovalReason] = useState("");
  const [approvalError, setApprovalError] = useState("");
  const [isApprovingAction, setIsApprovingAction] = useState(false);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [saleMessage, setSaleMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [selectedReceipt, setSelectedReceipt] = useState<Transaction | null>(null);
  const [loadError, setLoadError] = useState("");
  const [barcodeInput, setBarcodeInput] = useState("");
  const [scanMessage, setScanMessage] = useState("");
  const barcodeInputRef = useRef<HTMLInputElement>(null);
  const handleShiftChange = useCallback((registerId: string | null, shiftId: string | null) => {
    setActiveRegisterId(registerId);
    setActiveShiftId(shiftId);
  }, []);

  const loadProducts = async () => {
    const branch = user?.role === "admin" ? activeBranch : user?.branch;
    const query = branch ? `?branch=${encodeURIComponent(branch)}` : "";
    const response = await fetch(`/api/products${query}`, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || "Unable to load products.");
    setProducts(data.products ?? []);
  };

  useEffect(() => {
    const loadSession = async () => {
      try {
        const response = await fetch("/api/auth/me", { cache: "no-store" });
        if (response.ok) {
          const data = await response.json();
          setUser(data.user ?? null);
          if (data.user?.branch) setActiveBranch(data.user.branch);
        }
      } catch {
        setAuthError("Unable to connect to the POS server.");
      } finally {
        setAuthLoading(false);
      }
    };
    void loadSession();
  }, []);

  useEffect(() => {
    if (!user) return;
    let active = true;
    const loadDashboardData = async () => {
      try {
        const productResponse = await fetch(`/api/products?branch=${encodeURIComponent(user.role === "admin" ? activeBranch : user.branch)}`, { cache: "no-store" });
        const productData = await productResponse.json();
        if (!productResponse.ok) throw new Error(productData.message || "Unable to load products.");
        if (!active) return;
        setProducts(productData.products ?? []);
        setLoadError("");
      } catch (error) {
        if (!active) return;
        setLoadError(error instanceof Error ? error.message : "Unable to load POS data.");
      }
    };
    void loadDashboardData();
    return () => {
      active = false;
    };
  }, [user, activeBranch]);

  const cartSignature = useMemo(
    () => cart.map((item) => `${item.id}:${item.qty}`).sort().join(","),
    [cart],
  );
  const activeDiscountPercent =
    discountApproval?.cartSignature === cartSignature &&
    discountApproval.registerId === activeRegisterId &&
    discountApproval.shiftId === activeShiftId &&
    discountApproval.branch === (user?.role === "admin" ? activeBranch : user?.branch)
    ? discountApproval.discountPercent
    : 0;
  const saleBreakdown = useMemo(() => {
    const subtotalCents = cart.reduce(
      (sum, item) => sum + Math.round(item.price * 100) * item.qty,
      0,
    );
    const discountCents = Math.round(subtotalCents * activeDiscountPercent / 100);
    const taxCents = Math.round((subtotalCents - discountCents) * 0.16);
    const totalCents = subtotalCents - discountCents + taxCents;
    return {
      subtotal: subtotalCents / 100,
      discount: discountCents / 100,
      tax: taxCents / 100,
      total: totalCents / 100,
    };
  }, [activeDiscountPercent, cart]);

  const categories = useMemo(
    () => ["All", ...new Set(products.map((product) => product.category))],
    [products],
  );
  const filteredProducts = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    return products.filter((product) =>
      (selectedCategory === "All" || product.category === selectedCategory) &&
      (!query ||
        product.name.toLowerCase().includes(query) ||
        product.category.toLowerCase().includes(query) ||
        product.barcode?.toLowerCase().includes(query)),
    );
  }, [products, searchTerm, selectedCategory]);
  const tabs: { id: Tab; label: string; allowed: boolean }[] = [
    { id: "pos", label: "Point of sale", allowed: true },
    { id: "inventory", label: "Inventory", allowed: user?.role !== "cashier" },
    { id: "reports", label: "Sales reports", allowed: user?.role !== "cashier" },
    { id: "staff", label: "Staff & roles", allowed: user?.role === "admin" },
    { id: "mpesa", label: "M-Pesa sandbox", allowed: Boolean(user) },
  ];

  const addToCart = (product: Product) => {
    const currentQty = cart.find((item) => item.id === product.id)?.qty ?? 0;
    if (!product.stockCounted) {
      setSaleMessage({ type: "error", text: `Record a verified opening count for ${product.name} at this branch first.` });
      return;
    }
    if (currentQty >= product.stock) {
      setSaleMessage({ type: "error", text: `Only ${product.stock} ${product.name} left in stock.` });
      return;
    }
    setCart((current) => {
      const existing = current.find((item) => item.id === product.id);
      return existing
        ? current.map((item) => item.id === product.id ? { ...item, qty: item.qty + 1 } : item)
        : [...current, { id: product.id, name: product.name, price: product.price, qty: 1 }];
    });
    setSaleMessage(null);
  };

  const scanBarcode = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const barcode = barcodeInput.trim();
    if (!barcode) return;
    const product = products.find((item) => item.barcode === barcode);
    if (!product) {
      setScanMessage(`No product found for barcode ${barcode}.`);
      return;
    }
    if (product.stock <= (cart.find((item) => item.id === product.id)?.qty ?? 0)) {
      setScanMessage(`No more ${product.name} available in stock.`);
      return;
    }
    addToCart(product);
    setBarcodeInput("");
    setScanMessage(`${product.name} added to the basket.`);
    barcodeInputRef.current?.focus();
  };

  const updateQty = (id: number, delta: number) => {
    if (delta <= 0) return;
    const product = products.find((item) => item.id === id);
    const currentQty = cart.find((item) => item.id === id)?.qty ?? 0;
    if (delta > 0 && (!product || currentQty >= product.stock)) {
      setSaleMessage({
        type: "error",
        text: product ? `Only ${product.stock} ${product.name} left in stock.` : "This product is no longer available.",
      });
      return;
    }
    setCart((current) =>
      current
        .map((item) => {
          if (item.id !== id) return item;
          const qty = item.qty + delta;
          return { ...item, qty: product ? Math.min(qty, product.stock) : qty };
        })
    );
  };

  const requestCartItemVoid = (id: number) => {
    const item = cart.find((candidate) => candidate.id === id);
    if (!item) return;
    if (!activeRegisterId || !activeShiftId) {
      setSaleMessage({ type: "error", text: "Open a register shift before requesting a manager-approved cart void." });
      return;
    }
    setApprovalError("");
    setApprovalReason("");
    setManagerEmail("");
    setManagerPassword("");
    setApprovalRequest({ action: "cart_item_void", productId: id, itemName: item.name });
  };

  const requestDiscountApproval = () => {
    const percentage = Number(discountPercent);
    if (
      !activeRegisterId ||
      !activeShiftId ||
      !cart.length ||
      !Number.isFinite(percentage) ||
      percentage <= 0 ||
      percentage > 100 ||
      Math.round(percentage * 100) !== percentage * 100
    ) {
      setSaleMessage({
        type: "error",
        text: "Open a register shift, add items, and enter a discount percentage from 0.01 to 100 with at most two decimals.",
      });
      return;
    }
    setApprovalError("");
    setApprovalReason("");
    setManagerEmail("");
    setManagerPassword("");
    setApprovalRequest({
      action: "basket_discount",
      discountPercent: percentage,
      cartSignature,
    });
  };

  const submitManagerApproval = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!approvalRequest || !user || !activeRegisterId || !activeShiftId) return;
    setIsApprovingAction(true);
    setApprovalError("");
    try {
      const response = await fetch("/api/pos/approvals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: approvalRequest.action,
          actionKey: crypto.randomUUID(),
          branch: user.role === "admin" ? activeBranch : user.branch,
          registerId: activeRegisterId,
          shiftId: activeShiftId,
          reason: approvalReason,
          managerEmail,
          managerPassword,
          cartItems: cart.map(({ id, qty }) => ({ id, qty })),
          ...(approvalRequest.action === "basket_discount"
            ? { discountPercent: approvalRequest.discountPercent }
            : { productId: approvalRequest.productId, removeQuantity: 1 }),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Manager approval was not accepted.");
      if (approvalRequest.action === "cart_item_void") {
        const { productId } = approvalRequest;
        setCart((current) =>
          current
            .map((item) => item.id === productId ? { ...item, qty: item.qty - 1 } : item)
            .filter((item) => item.qty > 0),
        );
        setSaleMessage({ type: "success", text: `One ${approvalRequest.itemName} voided from the unpaid basket. Approval recorded for ${data.approval.approverName}.` });
      } else {
        setDiscountApproval({
          id: data.approval.id,
          discountPercent: approvalRequest.discountPercent,
          cartSignature: approvalRequest.cartSignature,
          approverName: data.approval.approverName,
          branch: user.role === "admin" ? activeBranch : user.branch,
          registerId: activeRegisterId,
          shiftId: activeShiftId,
        });
        setSaleMessage({ type: "success", text: `${approvalRequest.discountPercent}% basket discount approved by ${data.approval.approverName}.` });
      }
      setApprovalRequest(null);
      setManagerPassword("");
    } catch (error) {
      setApprovalError(error instanceof Error ? error.message : "Manager approval was not accepted.");
    } finally {
      setIsApprovingAction(false);
    }
  };

  const handleLogin = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAuthError("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await response.json();
      if (!response.ok) {
        setAuthError(data.message || "Login failed.");
        return;
      }
      setUser(data.user);
      setActiveBranch(data.user.branch);
      setActiveTab("pos");
      setActiveRegisterId(null);
      setActiveShiftId(null);
    } catch {
      setAuthError("Unable to connect to the POS server.");
    }
  };

  const handleLogout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      setUser(null);
      setCart([]);
      setCustomerName("Walk-in customer");
      setSaleMessage(null);
      setSelectedReceipt(null);
      setActiveRegisterId(null);
      setActiveShiftId(null);
    }
  };

  const submitSale = async () => {
    if (!cart.length || !user) return;
    if (paymentMethod === "MpesaSandbox") {
      setSaleMessage({ type: "error", text: "Sandbox tests are separate from checkout and cannot record a sale." });
      return;
    }
    if (!checkoutReadiness.enabled) {
      setSaleMessage({ type: "error", text: checkoutReadiness.message });
      return;
    }
    if (!activeRegisterId || !activeShiftId) {
      setSaleMessage({ type: "error", text: "Open a register shift before checkout." });
      return;
    }
    const tendered = paymentMethod === "Cash" ? Number(cashTendered) : 0;
    if (paymentMethod === "Cash" && (!Number.isFinite(tendered) || tendered < saleBreakdown.total)) {
      setSaleMessage({ type: "error", text: "Enter cash received equal to or greater than the total." });
      return;
    }
    setIsSubmitting(true);
    setSaleMessage(null);
    try {
      const response = await fetch("/api/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branch: user.role === "admin" ? activeBranch : user.branch,
          registerId: activeRegisterId,
          customer: customerName,
          paymentMethod,
          cashTendered: paymentMethod === "Cash" ? tendered : undefined,
          discountApprovalId: activeDiscountPercent > 0 ? discountApproval?.id : undefined,
          discountPercent: activeDiscountPercent,
          items: cart.map(({ id, qty }) => ({ id, qty })),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Sale failed.");
      setSaleMessage({ type: "success", text: "Sale saved. Receipt is ready to print." });
      setSelectedReceipt(data.transaction);
      setCart([]);
      setCustomerName("Walk-in customer");
      setCashTendered("");
      setPaymentMethod("Cash");
      setDiscountPercent("");
      setDiscountApproval(null);
      try {
        await loadProducts();
        setLoadError("");
      } catch {
        setLoadError("Sale saved, but dashboard data could not be refreshed. Reload to see current inventory and sales.");
      }
    } catch (error) {
      setSaleMessage({ type: "error", text: error instanceof Error ? error.message : "Sale failed." });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (authLoading) {
    return <main className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-200"><div className="text-sm uppercase tracking-[0.3em] text-sky-300">Loading Checonex Retail...</div></main>;
  }

  if (!user) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4">
        <div className="w-full max-w-md rounded-3xl border border-slate-800 bg-slate-900/80 p-6 shadow-2xl shadow-sky-950/40 sm:p-7">
          <div className="mb-5">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-700 text-lg font-black text-white">C</div>
              <div><p className="text-lg font-bold tracking-tight text-slate-900">CHECONEX</p><p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">Retail operations</p></div>
            </div>
            <h1 className="text-2xl font-bold text-slate-900">Welcome back</h1>
            <p className="mt-1.5 text-sm text-slate-500">Sign in to your branch workspace.</p>
          </div>
          <form onSubmit={handleLogin} className="space-y-3.5">
            <div><label className="mb-1.5 block text-sm font-medium text-slate-300">Work email</label><input type="email" required autoComplete="username" placeholder="staff@checonex.co.ke" value={email} onChange={(event) => setEmail(event.target.value)} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-white outline-none placeholder:text-slate-500 focus:border-sky-500" /></div>
            <div><label className="mb-1.5 block text-sm font-medium text-slate-300">Password</label><input type="password" required autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-white outline-none placeholder:text-slate-500 focus:border-sky-500" /></div>
            {authError ? <p role="alert" className="text-sm text-rose-300">{authError}</p> : null}
            <button className="w-full rounded-xl bg-gradient-to-r from-sky-500 to-indigo-500 px-4 py-2.5 font-semibold text-white">Sign in</button>
          </form>
          <p className="mt-4 border-t border-slate-800 pt-3 text-xs text-slate-500">Secure staff access · Checonex Supermarket</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 px-3 py-3 text-slate-100 sm:px-4">
      <div className="mx-auto max-w-[1600px]">
        <header className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-800 bg-slate-900/80 px-2.5 py-2 sm:px-3">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-700 text-base font-black text-white shadow-sm">C</div>
            <div><p className="text-sm font-extrabold leading-tight tracking-tight text-slate-900">CHECONEX</p><p className="mt-0.5 text-[9px] font-semibold uppercase tracking-[0.16em] text-slate-500">Retail operations</p></div>
            <span className="ml-1 hidden rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-amber-800 xl:inline-flex">Preview</span>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            {user.role === "admin" ? (
              <select aria-label="Select branch" value={activeBranch} onChange={(event) => {
                setActiveBranch(event.target.value);
                setCart([]);
                setSaleMessage(null);
                setActiveRegisterId(null);
                setActiveShiftId(null);
              }} className="rounded-xl border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs">
                {branches.map((branch) => <option key={branch}>{branch}</option>)}
              </select>
            ) : <span className="rounded-xl border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs">{user.branch}</span>}
            <div className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-950 px-2 py-1 text-xs"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-100 text-[10px] font-bold text-emerald-800">{user.name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase()}</span><span><span className="block font-semibold">{user.name}</span><span className="block text-[9px] uppercase tracking-wider text-slate-500">{user.role}</span></span></div>
            <button onClick={handleLogout} className="rounded-xl border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs font-medium hover:border-slate-500">Sign out</button>
          </div>
        </header>

        {activeTab !== "pos" ? (
          <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">Management</p><h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">{tabs.find((tab) => tab.id === activeTab)?.label}</h1></div>
            <p className="text-sm text-slate-500">{user.role === "admin" ? activeBranch : user.branch} <span className="mx-1 text-slate-300">·</span> {new Intl.DateTimeFormat("en-KE", { dateStyle: "full" }).format(new Date())}</p>
          </div>
        ) : null}

        <nav className="mb-2 flex flex-wrap gap-1.5 border-b border-slate-800 pb-2" aria-label="POS sections">
          {tabs.filter((tab) => tab.allowed).map((tab) => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`rounded-xl px-3.5 py-2 text-sm font-medium ${activeTab === tab.id ? "bg-sky-600 text-white" : "border border-slate-800 bg-slate-900 text-slate-300 hover:border-slate-600"}`}>{tab.label}</button>
          ))}
        </nav>

        {loadError ? <p role="alert" className="mb-3 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">{loadError}</p> : null}

        {activeTab === "pos" ? (
          <RegisterShiftPanel
            branch={user.role === "admin" ? activeBranch : user.branch}
            canManageRegisters={user.role !== "cashier"}
            onShiftChange={handleShiftChange}
          />
        ) : null}

        {activeTab === "pos" ? (
          <section className="grid min-h-[calc(100vh-10rem)] gap-3 sm:grid-cols-[minmax(270px,0.92fr)_minmax(0,1.25fr)] md:h-[calc(100vh-10rem)] md:min-h-[380px] md:grid-cols-[minmax(310px,0.88fr)_minmax(0,1.55fr)]">
            <aside className="flex min-h-[420px] flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/80 md:min-h-0">
              <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
                <div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">{user.role === "admin" ? activeBranch : user.branch}</p><h1 className="mt-0.5 text-lg font-bold text-slate-900">Current sale</h1></div>
                <div className="flex items-center gap-2"><span className="rounded-full bg-sky-500/10 px-2.5 py-1 text-xs font-medium text-sky-300">{cart.reduce((sum, item) => sum + item.qty, 0)} items</span>{cart.length ? <button onClick={() => setCart([])} className="rounded-lg border border-slate-700 px-2.5 py-1.5 text-xs font-medium">Clear</button> : null}</div>
              </div>

              <div className="min-h-28 flex-1 overflow-auto">
                {cart.length === 0 ? (
                  <table className="w-full min-w-[440px] border-collapse text-left text-xs">
                    <thead className="sticky top-0 z-10 bg-slate-800 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                      <tr><th className="border-b border-r border-slate-700 px-2 py-2 font-semibold sm:px-3">Code</th><th className="border-b border-r border-slate-700 px-2 py-2 font-semibold sm:px-3">Description</th><th className="border-b border-r border-slate-700 px-2 py-2 text-right font-semibold sm:px-3">Unit price</th><th className="border-b border-r border-slate-700 px-2 py-2 text-center font-semibold sm:px-3">Qty</th><th className="border-b border-slate-700 px-2 py-2 text-right font-semibold sm:px-3">Amount</th></tr>
                    </thead>
                    <tbody><tr><td colSpan={5} className="h-32 border-b border-slate-800 px-4 text-center text-slate-500">No items yet — scan a barcode or choose a product.</td></tr></tbody>
                  </table>
                ) : (
                  <table className="w-full min-w-[440px] border-collapse text-left text-xs">
                    <thead className="sticky top-0 z-10 bg-slate-800 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                      <tr><th className="border-b border-r border-slate-700 px-2 py-2 font-semibold sm:px-3">Code</th><th className="border-b border-r border-slate-700 px-2 py-2 font-semibold sm:px-3">Description</th><th className="border-b border-r border-slate-700 px-2 py-2 text-right font-semibold sm:px-3">Unit price</th><th className="border-b border-r border-slate-700 px-2 py-2 text-center font-semibold sm:px-3">Qty</th><th className="border-b border-slate-700 px-2 py-2 text-right font-semibold sm:px-3">Amount</th></tr>
                    </thead>
                    <tbody>
                      {cart.map((item) => {
                        const product = products.find((candidate) => candidate.id === item.id);
                        return (
                          <tr key={item.id} className="odd:bg-slate-950/30 hover:bg-emerald-50/50">
                            <td className="border-b border-r border-slate-800 px-2 py-2 font-mono text-[10px] text-slate-500 sm:px-3">{product?.barcode || String(item.id).padStart(5, "0")}</td>
                            <td className="max-w-36 truncate border-b border-r border-slate-800 px-2 py-2 font-medium text-slate-900 sm:max-w-none sm:px-3">{item.name}</td>
                            <td className="whitespace-nowrap border-b border-r border-slate-800 px-2 py-2 text-right text-slate-500 sm:px-3">{formatCurrency(item.price)}</td>
                            <td className="border-b border-r border-slate-800 px-1 py-1 sm:px-2">
                              <div className="mx-auto flex w-fit items-center rounded-md border border-slate-700 bg-white">
                                <button aria-label={`Request void of one ${item.name}`} onClick={() => requestCartItemVoid(item.id)} className="h-7 w-6 border-r border-slate-700 text-sm text-slate-600 hover:bg-slate-100">−</button>
                                <span className="w-8 text-center text-xs font-semibold tabular-nums text-slate-900">{item.qty}</span>
                                <button aria-label={`Add one ${item.name}`} onClick={() => updateQty(item.id, 1)} className="h-7 w-6 border-l border-slate-700 text-sm text-slate-600 hover:bg-slate-100">+</button>
                              </div>
                            </td>
                            <td className="whitespace-nowrap border-b border-slate-800 px-2 py-2 text-right font-semibold tabular-nums text-slate-900 sm:px-3">{formatCurrency(item.price * item.qty)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>

              <div className="space-y-2.5 border-t border-slate-800 bg-slate-800 p-3 sm:p-4">
                <div className="grid grid-cols-2 gap-2">
                  <input value={customerName} onChange={(event) => setCustomerName(event.target.value)} className="min-w-0 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm" placeholder="Customer name" aria-label="Customer name" />
                  <select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)} aria-label="Payment method" className="min-w-0 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm"><option value="Cash">Cash</option><option value="MpesaSandbox">M-Pesa sandbox test</option><option value="Card">Card · external</option></select>
                </div>
                {paymentMethod === "Card" ? <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs text-amber-800">Confirm payment on the provider terminal before completing the sale.</p> : null}
                {paymentMethod === "Cash" ? <label className="flex items-center gap-3 text-xs text-slate-500"><span className="shrink-0">Cash received</span><input type="number" min={saleBreakdown.total} step="0.01" value={cashTendered} onChange={(event) => setCashTendered(event.target.value)} className="min-w-0 flex-1 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm" placeholder="Enter amount (KES)" /></label> : null}
                {paymentMethod === "MpesaSandbox" ? <MpesaSandboxPanel compact /> : null}
                <div className="rounded-lg border border-slate-700 bg-slate-950/60 p-2.5">
                  <div className="flex items-end gap-2">
                    <label className="flex-1 text-xs text-slate-400">
                      Basket discount (%)
                      <input
                        aria-label="Basket discount percentage"
                        type="number"
                        min="0.01"
                        max="100"
                        step="0.01"
                        value={discountPercent}
                        onChange={(event) => setDiscountPercent(event.target.value)}
                        className="mt-1 block w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-sm text-white"
                      />
                    </label>
                    <button
                      type="button"
                      disabled={!cart.length || !activeRegisterId || !activeShiftId || isApprovingAction}
                      onClick={requestDiscountApproval}
                      className="rounded-lg border border-sky-700 px-3 py-2 text-xs font-semibold text-sky-200 disabled:opacity-50"
                    >
                      Request manager approval
                    </button>
                  </div>
                  {activeDiscountPercent > 0 ? (
                    <p className="mt-2 text-xs text-emerald-300">
                      {activeDiscountPercent}% approved by {discountApproval?.approverName}; discount {formatCurrency(saleBreakdown.discount)}.
                    </p>
                  ) : discountApproval ? (
                    <p className="mt-2 text-xs text-amber-300">Basket changed; previous discount approval is no longer valid.</p>
                  ) : null}
                </div>
                <div className="space-y-1.5 border-t border-slate-800 pt-2.5 text-sm">
                  <div className="flex justify-between text-slate-500"><span>Subtotal</span><span>{formatCurrency(saleBreakdown.subtotal)}</span></div>
                  <div className="flex justify-between text-slate-500"><span>VAT preview</span><span>{formatCurrency(saleBreakdown.tax)}</span></div>
                  <div className="flex items-center justify-between pt-0.5 text-base font-bold text-slate-900"><span>Total</span><span>{formatCurrency(saleBreakdown.total)}</span></div>
                  {paymentMethod === "Cash" && cashTendered ? <div className="flex justify-between text-sm font-semibold text-emerald-700"><span>Change due</span><span>{formatCurrency(Math.max(0, Number(cashTendered) - saleBreakdown.total))}</span></div> : null}
                </div>
                {!checkoutReadiness.enabled ? <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs text-amber-800">Preview only — live checkout is disabled until tax rules and eTIMS receipts are configured.</p> : null}
                <button onClick={() => void submitSale()} disabled={!checkoutReadiness.enabled || !activeRegisterId || !activeShiftId || isSubmitting || !cart.length || paymentMethod === "MpesaSandbox" || (paymentMethod === "Cash" && (!cashTendered || Number(cashTendered) < saleBreakdown.total))} className="w-full rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60">{paymentMethod === "MpesaSandbox" ? "Sandbox test is not a sale" : !activeShiftId ? "Open a register shift" : checkoutReadiness.enabled ? isSubmitting ? "Processing..." : "Complete sale" : "Checkout unavailable"}</button>
                {saleMessage ? <div className="space-y-1"><p role="status" className={saleMessage.type === "success" ? "text-sm text-emerald-700" : "text-sm text-rose-300"}>{saleMessage.text}</p>{saleMessage.type === "success" && selectedReceipt ? <button onClick={() => window.print()} className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs">Print receipt</button> : null}</div> : null}
              </div>
            </aside>

            <section className="flex min-h-[420px] flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/80 md:min-h-0">
              <div className="border-b border-slate-800 p-3 sm:p-4">
                <div className="mb-3 flex items-center justify-between gap-3"><div><h2 className="text-lg font-bold text-slate-900">Products</h2><p className="mt-0.5 text-xs text-slate-500">Tap an item to add it to the sale</p></div><span className="rounded-full bg-slate-800 px-2.5 py-1 text-xs text-slate-400">{filteredProducts.length} {filteredProducts.length === 1 ? "product" : "products"}</span></div>
                <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(180px,0.8fr)]">
                  <input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Search products" aria-label="Search products" className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm placeholder:text-slate-500" />
                  <form onSubmit={scanBarcode} className="flex min-w-0 gap-2">
                    <input ref={barcodeInputRef} value={barcodeInput} onChange={(event) => { setBarcodeInput(event.target.value); setScanMessage(""); }} autoComplete="off" aria-label="Scan product barcode" placeholder="Scan barcode…" className="min-w-0 flex-1 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm" />
                    <button className="rounded-xl border border-slate-700 px-3 py-2 text-sm font-medium">Add</button>
                  </form>
                </div>
                <div className="mt-2.5 flex flex-wrap gap-1.5" aria-label="Product categories">
                  {categories.map((category) => <button key={category} onClick={() => setSelectedCategory(category)} aria-pressed={selectedCategory === category} className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium ${selectedCategory === category ? "bg-emerald-700 text-white" : "border border-slate-800 bg-slate-950 text-slate-500 hover:border-slate-600"}`}>{category}</button>)}
                </div>
                {scanMessage ? <p role="status" className="mt-2 text-xs text-slate-500">{scanMessage}</p> : null}
                {products.some((product) => !product.stockCounted) ? (
                  <div role="status" className="mt-2.5 flex items-center justify-between gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    <span>Opening stock count required for {user.role === "admin" ? activeBranch : user.branch}.</span>
                    {user.role !== "cashier" ? <button onClick={() => setActiveTab("inventory")} className="shrink-0 font-semibold underline underline-offset-2">Record count</button> : null}
                  </div>
                ) : null}
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
                {filteredProducts.length ? (
                  <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-4">
                    {filteredProducts.map((product) => {
                      const canAdd = product.stockCounted && product.stock > (cart.find((item) => item.id === product.id)?.qty ?? 0);
                      return (
                        <button key={product.id} onClick={() => addToCart(product)} disabled={!canAdd} className="group flex min-h-32 flex-col justify-between rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-left transition hover:border-emerald-600 hover:bg-emerald-50/40 disabled:cursor-not-allowed disabled:opacity-60 sm:min-h-36 sm:p-3.5">
                          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-100 text-xs font-bold uppercase text-emerald-800">{product.category.slice(0, 2)}</span>
                          <span className="mt-3 block w-full"><span className="block line-clamp-2 min-h-9 text-sm font-semibold leading-4 text-slate-900">{product.name}</span><span className="mt-1.5 flex items-center justify-between gap-1"><span className="font-bold text-emerald-700">{formatCurrency(product.price)}</span><span className={`text-[10px] ${product.stockCounted && product.stock > 0 ? "text-slate-500" : "text-amber-700"}`}>{product.stockCounted ? `${product.stock} in stock` : "Count required"}</span></span></span>
                        </button>
                      );
                    })}
                  </div>
                ) : <div className="flex h-full min-h-48 items-center justify-center rounded-xl border border-dashed border-slate-700 p-4 text-sm text-slate-500">No products match your search.</div>}
              </div>
            </section>
          </section>
        ) : null}

        {activeTab === "inventory" && user.role !== "cashier" ? <InventoryPanel branch={user.role === "admin" ? activeBranch : user.branch} products={products} onChanged={loadProducts} /> : null}
        {activeTab === "reports" && user.role !== "cashier" ? <ReportsPanel branch={user.role === "admin" ? activeBranch : undefined} /> : null}
        {activeTab === "staff" && user.role === "admin" ? <StaffPanel /> : null}
        {activeTab === "mpesa" ? <MpesaSandboxPanel /> : null}
      </div>
      {selectedReceipt ? (
        <div className="no-print fixed bottom-4 right-4 z-40 flex items-center gap-3 rounded-2xl border border-slate-700 bg-slate-900 p-3 shadow-xl">
          <span className="max-w-48 truncate text-xs text-slate-300">Receipt {selectedReceipt.id}</span>
          <button onClick={() => window.print()} className="rounded-lg bg-sky-600 px-3 py-2 text-sm font-semibold text-white">Print receipt</button>
          <button aria-label="Close receipt preview" onClick={() => setSelectedReceipt(null)} className="rounded-lg border border-slate-700 px-3 py-2 text-sm">Close</button>
        </div>
      ) : null}
      {approvalRequest ? (
        <div className="no-print fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <form onSubmit={(event) => void submitManagerApproval(event)} className="w-full max-w-md space-y-3 rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl">
            <div>
              <h2 className="text-lg font-semibold text-white">Manager approval required</h2>
              <p className="mt-1 text-sm text-slate-400">
                {approvalRequest.action === "basket_discount"
                  ? `Approve a ${approvalRequest.discountPercent}% discount on ${cart.length} basket line(s), subtotal ${formatCurrency(saleBreakdown.subtotal)}?`
                  : `Approve removing one ${approvalRequest.itemName} from the unpaid basket?`}
              </p>
            </div>
            <div className="max-h-36 overflow-y-auto rounded-lg border border-slate-700 bg-slate-950 p-2 text-xs text-slate-300">
              {cart.map((item) => (
                <p key={item.id} className="flex justify-between gap-3 py-1">
                  <span>{item.name} × {item.qty}</span>
                  <span>{formatCurrency(item.price * item.qty)}</span>
                </p>
              ))}
            </div>
            <label className="block text-sm text-slate-300">
              Reason
              <input required maxLength={255} value={approvalReason} onChange={(event) => setApprovalReason(event.target.value)} className="mt-1 block w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white" />
            </label>
            <label className="block text-sm text-slate-300">
              Manager/admin email
              <input required type="email" autoComplete="off" value={managerEmail} onChange={(event) => setManagerEmail(event.target.value)} className="mt-1 block w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white" />
            </label>
            <label className="block text-sm text-slate-300">
              Manager/admin password
              <input required type="password" autoComplete="new-password" value={managerPassword} onChange={(event) => setManagerPassword(event.target.value)} className="mt-1 block w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white" />
            </label>
            {approvalError ? <p role="alert" className="text-sm text-rose-300">{approvalError}</p> : null}
            <div className="flex justify-end gap-2">
              <button type="button" disabled={isApprovingAction} onClick={() => setApprovalRequest(null)} className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300">Cancel</button>
              <button type="submit" disabled={isApprovingAction} className="rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{isApprovingAction ? "Verifying..." : "Approve and record"}</button>
            </div>
          </form>
        </div>
      ) : null}
      {selectedReceipt ? <Receipt transaction={selectedReceipt} /> : null}
    </main>
  );
}

function Receipt({ transaction }: { transaction: Transaction }) {
  return (
    <section id="print-receipt" aria-label="Receipt" className="hidden">
      <div className="receipt-content">
        <h1>CHECONEX</h1>
        <p>SUPERMARKET · SALES RECEIPT</p>
        <hr />
        <p>Receipt: {transaction.id}</p>
        <p>Date: {new Date(transaction.createdAt).toLocaleString()}</p>
        <p>Branch: {transaction.branch}</p>
        <p>Cashier: {transaction.cashierName}</p>
        <p>Customer: {transaction.customer}</p>
        <p>Payment: {transaction.paymentMethod}</p>
        <hr />
        {transaction.items.map((item) => (
          <div key={`${item.id}-${item.name}`} className="receipt-line">
            <span>{item.name} × {item.qty}</span><span>{formatCurrency(item.price * item.qty)}</span>
          </div>
        ))}
        <hr />
        <div className="receipt-line"><span>Subtotal</span><span>{formatCurrency(transaction.subtotal)}</span></div>
        {transaction.discount > 0 ? <div className="receipt-line"><span>Discount</span><span>-{formatCurrency(transaction.discount)}</span></div> : null}
        <div className="receipt-line"><span>VAT (16%)</span><span>{formatCurrency(transaction.tax)}</span></div>
        <div className="receipt-line receipt-total"><span>Total</span><span>{formatCurrency(transaction.total)}</span></div>
        {transaction.paymentMethod === "Cash" ? (
          <>
            <div className="receipt-line"><span>Cash received</span><span>{formatCurrency(transaction.cashTendered)}</span></div>
            <div className="receipt-line"><span>Change</span><span>{formatCurrency(transaction.changeDue)}</span></div>
          </>
        ) : null}
        <p className="receipt-thanks">Thank you for shopping with us.</p>
      </div>
    </section>
  );
}
