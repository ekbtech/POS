"use client";

import { FormEvent, useEffect, useState } from "react";

type StaffMember = {
  id: string;
  name: string;
  email: string;
  role: "admin" | "manager" | "cashier";
  branch: string;
};

const branches = ["Nairobi CBD", "Westlands", "Mombasa", "Kisumu"];

export default function StaffPanel() {
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "cashier", branch: branches[0] });
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const load = async () => {
    const response = await fetch("/api/staff", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || "Unable to load staff.");
    setStaff(data.staff);
  };

  useEffect(() => {
    const loadStaff = async () => {
      try {
        const response = await fetch("/api/staff", { cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || "Unable to load staff.");
        setStaff(data.staff);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Unable to load staff.");
      }
    };
    void loadStaff();
  }, []);

  const addStaff = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch("/api/staff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Unable to create staff account.");
      setForm({ name: "", email: "", password: "", role: "cashier", branch: branches[0] });
      setMessage("Staff account created.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to create staff account.");
    } finally {
      setLoading(false);
    }
  };

  const updateMember = async (member: StaffMember, role: StaffMember["role"], branch: string) => {
    setMessage("");
    try {
      const response = await fetch(`/api/staff/${member.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: member.name, role, branch }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Unable to update staff account.");
      await load();
      setMessage(`${member.name}'s access updated.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to update staff account.");
    }
  };

  return (
    <section className="space-y-5">
      <div className="rounded-3xl border border-slate-800 bg-slate-900/80 p-5">
        <h2 className="text-xl font-semibold">Add staff member</h2>
        <p className="mt-1 text-sm text-slate-400">Cashiers can make sales. Managers can also manage inventory and view reports.</p>
        <form onSubmit={addStaff} className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <input required maxLength={160} placeholder="Full name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2" />
          <input required type="email" maxLength={254} placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2" />
          <input required minLength={10} type="password" placeholder="Initial password (10+ chars)" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2" />
          <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2">
            <option value="cashier">Cashier</option><option value="manager">Manager</option>
          </select>
          <select value={form.branch} onChange={(e) => setForm({ ...form, branch: e.target.value })} className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2">
            {branches.map((branch) => <option key={branch}>{branch}</option>)}
          </select>
          <button disabled={loading} className="rounded-xl bg-sky-600 px-4 py-2 font-semibold text-white disabled:opacity-60">{loading ? "Creating..." : "Create account"}</button>
          {message ? <p role="status" className="self-center text-sm text-slate-300 sm:col-span-2">{message}</p> : null}
        </form>
      </div>
      <div className="overflow-x-auto rounded-3xl border border-slate-800 bg-slate-900/80">
        <table className="w-full min-w-[700px] text-left text-sm">
          <thead className="bg-slate-950/70 text-slate-400"><tr><th className="p-4">Staff</th><th className="p-4">Email</th><th className="p-4">Role</th><th className="p-4">Branch</th><th className="p-4">Save access</th></tr></thead>
          <tbody>
            {staff.map((member) => (
              <StaffRow key={member.id} member={member} onSave={updateMember} />
            ))}
            {staff.length === 0 ? <tr><td colSpan={5} className="p-8 text-center text-slate-400">No staff accounts found.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function StaffRow({
  member,
  onSave,
}: {
  member: StaffMember;
  onSave: (member: StaffMember, role: StaffMember["role"], branch: string) => Promise<void>;
}) {
  const [role, setRole] = useState(member.role);
  const [branch, setBranch] = useState(member.branch);
  return (
    <tr className="border-t border-slate-800">
      <td className="p-4 font-medium">{member.name}</td>
      <td className="p-4 text-slate-400">{member.email}</td>
      <td className="p-4">
        <select value={role} onChange={(event) => setRole(event.target.value as StaffMember["role"])} className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5">
          <option value="admin">Admin</option><option value="manager">Manager</option><option value="cashier">Cashier</option>
        </select>
      </td>
      <td className="p-4">
        <select value={branch} onChange={(event) => setBranch(event.target.value)} className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5">
          {branches.map((name) => <option key={name}>{name}</option>)}
        </select>
      </td>
      <td className="p-4"><button onClick={() => void onSave(member, role, branch)} className="rounded-lg border border-slate-700 px-3 py-1.5 hover:border-sky-500">Save</button></td>
    </tr>
  );
}
