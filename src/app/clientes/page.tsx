"use client";
import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import type { Cliente, Plan } from "@/types";
import Modal from "@/components/Modal";
import ConfirmDialog from "@/components/ConfirmDialog";

const PLANES: Plan[] = ["Básico", "Estándar", "Premium", "Personalizado"];

const emptyForm = { nombre: "", tel: "", dir: "", plan: "Estándar" as Plan, comidas: 20, notas: "" };

export default function ClientesPage() {
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const fetchClientes = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("clientes")
      .select("*")
      .order("nombre");
    setClientes(data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchClientes(); }, [fetchClientes]);

  const filtered = clientes.filter(c =>
    c.nombre.toLowerCase().includes(search.toLowerCase())
  );

  function openNew() {
    setEditId(null);
    setForm(emptyForm);
    setModalOpen(true);
  }

  function openEdit(c: Cliente) {
    setEditId(c.id);
    setForm({ nombre: c.nombre, tel: c.tel, dir: c.dir, plan: c.plan as Plan, comidas: c.comidas, notas: c.notas });
    setModalOpen(true);
  }

  async function save() {
    if (!form.nombre.trim()) return alert("El nombre es obligatorio");
    setSaving(true);
    if (editId) {
      await supabase.from("clientes").update(form).eq("id", editId);
    } else {
      await supabase.from("clientes").insert(form);
    }
    setSaving(false);
    setModalOpen(false);
    fetchClientes();
  }

  async function deleteCliente(id: number) {
    await supabase.from("clientes").delete().eq("id", id);
    fetchClientes();
  }

  const planColor: Record<string, string> = {
    "Básico": "bg-gray-100 text-gray-700",
    "Estándar": "bg-green-50 text-green-700",
    "Premium": "bg-purple-50 text-purple-700",
    "Personalizado": "bg-amber-50 text-amber-700",
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-xl font-semibold">Clientes</h1>
        <button onClick={openNew} className="flex items-center gap-1.5 px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 transition-colors">
          + Agregar cliente
        </button>
      </div>

      <div className="flex items-center gap-2 mb-4">
        <span className="text-gray-400 text-sm">🔍</span>
        <input
          type="text"
          placeholder="Buscar por nombre…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm w-72 focus:outline-none focus:ring-2 focus:ring-green-200"
        />
        {search && (
          <button onClick={() => setSearch("")} className="text-xs text-gray-400 hover:text-gray-600">✕ limpiar</button>
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-100">
              {["Nombre", "Teléfono", "Dirección", "Plan", "Comidas rest.", "Notas", ""].map(h => (
                <th key={h} className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wide whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="text-center py-12 text-sm text-gray-400">Cargando…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={7} className="text-center py-12 text-sm text-gray-400">
                {search ? "No se encontraron clientes" : "Todavía no hay clientes. ¡Agregá el primero!"}
              </td></tr>
            ) : filtered.map(c => (
              <tr key={c.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                <td className="px-4 py-3 font-medium text-sm">{c.nombre}</td>
                <td className="px-4 py-3 text-sm text-gray-600">{c.tel}</td>
                <td className="px-4 py-3 text-sm text-gray-600 max-w-48 truncate">{c.dir}</td>
                <td className="px-4 py-3">
                  <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${planColor[c.plan] ?? "bg-gray-100 text-gray-700"}`}>{c.plan}</span>
                </td>
                <td className="px-4 py-3">
                  <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${c.comidas > 10 ? "bg-green-50 text-green-700" : "bg-amber-50 text-amber-700"}`}>
                    {c.comidas}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs text-gray-400 max-w-32 truncate">{c.notas}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1">
                    <button onClick={() => openEdit(c)} className="px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">✏️</button>
                    <button onClick={() => setConfirmId(c.id)} className="px-2.5 py-1.5 text-xs border border-red-100 text-red-500 rounded-lg hover:bg-red-50 transition-colors">🗑️</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editId ? "Editar cliente" : "Agregar cliente"}>
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Nombre *</label>
            <input value={form.nombre} onChange={e => setForm(f => ({...f, nombre: e.target.value}))}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-200" placeholder="Juan García" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Teléfono / WeChat</label>
            <input value={form.tel} onChange={e => setForm(f => ({...f, tel: e.target.value}))}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-200" placeholder="+54 9 11…" />
          </div>
        </div>
        <div className="mb-4">
          <label className="block text-xs font-medium text-gray-500 mb-1">Dirección</label>
          <input value={form.dir} onChange={e => setForm(f => ({...f, dir: e.target.value}))}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-200" placeholder="Av. Corrientes 1234" />
        </div>
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Plan</label>
            <select value={form.plan} onChange={e => setForm(f => ({...f, plan: e.target.value as Plan}))}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-200 bg-white">
              {PLANES.map(p => <option key={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Comidas restantes</label>
            <input type="number" min={0} value={form.comidas} onChange={e => setForm(f => ({...f, comidas: parseInt(e.target.value) || 0}))}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-200" />
          </div>
        </div>
        <div className="mb-5">
          <label className="block text-xs font-medium text-gray-500 mb-1">Notas</label>
          <textarea value={form.notas} onChange={e => setForm(f => ({...f, notas: e.target.value}))}
            rows={3} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-200 resize-none"
            placeholder="Alergias, restricciones, preferencias…" />
        </div>
        <div className="flex gap-2 justify-end border-t border-gray-100 pt-4">
          <button onClick={() => setModalOpen(false)} className="px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
            Cancelar
          </button>
          <button onClick={save} disabled={saving}
            className="px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50">
            {saving ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </Modal>

      <ConfirmDialog
        open={confirmId !== null}
        onClose={() => setConfirmId(null)}
        onConfirm={() => confirmId && deleteCliente(confirmId)}
        message="Se eliminará el cliente y todos sus pedidos asociados."
      />
    </div>
  );
}
