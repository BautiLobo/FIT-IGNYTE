"use client";
import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import type { Cliente, Comida, Pedido } from "@/types";
import Modal from "@/components/Modal";
import ConfirmDialog from "@/components/ConfirmDialog";

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

const emptyForm = { cliente_id: 0, fecha: todayStr(), comida: "", notas: "" };

export default function PedidosPage() {
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [comidas, setComidas] = useState<Comida[]>([]);
  const [filterFecha, setFilterFecha] = useState("");
  const [filterCliente, setFilterCliente] = useState("");
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [nuevaComida, setNuevaComida] = useState("");

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const [{ data: p }, { data: c }, { data: m }] = await Promise.all([
      supabase.from("pedidos").select("*, clientes(nombre)").order("fecha", { ascending: false }).order("id", { ascending: false }),
      supabase.from("clientes").select("*").order("nombre"),
      supabase.from("comidas").select("*").order("nombre"),
    ]);
    setPedidos(p ?? []);
    setClientes(c ?? []);
    setComidas(m ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const filtered = pedidos.filter(p => {
    if (filterFecha && p.fecha !== filterFecha) return false;
    if (filterCliente && p.cliente_id !== parseInt(filterCliente)) return false;
    return true;
  });

  function openNew() {
    setEditId(null);
    setForm({ cliente_id: clientes[0]?.id ?? 0, fecha: todayStr(), comida: comidas[0]?.nombre ?? "", notas: "" });
    setModalOpen(true);
  }

  function openEdit(p: Pedido) {
    setEditId(p.id);
    setForm({ cliente_id: p.cliente_id, fecha: p.fecha, comida: p.comida, notas: p.notas });
    setModalOpen(true);
  }

  async function save() {
    if (!form.cliente_id || !form.fecha || !form.comida) return alert("Completá todos los campos obligatorios");
    setSaving(true);
    if (editId) {
      await supabase.from("pedidos").update(form).eq("id", editId);
    } else {
      await supabase.from("pedidos").insert(form);
    }
    setSaving(false);
    setModalOpen(false);
    fetchAll();
  }

  async function deletePedido(id: number) {
    await supabase.from("pedidos").delete().eq("id", id);
    fetchAll();
  }

  async function addComida() {
    const nombre = nuevaComida.trim();
    if (!nombre) return;
    await supabase.from("comidas").insert({ nombre });
    setNuevaComida("");
    fetchAll();
  }

  async function deleteComida(id: number) {
    await supabase.from("comidas").delete().eq("id", id);
    fetchAll();
  }

  function fmtDate(s: string) {
    if (!s) return "";
    const [y, m, d] = s.split("-");
    return `${d}/${m}/${y}`;
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-xl font-semibold">Menú / Pedidos</h1>
        <button onClick={openNew} className="flex items-center gap-1.5 px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 transition-colors">
          + Nuevo pedido
        </button>
      </div>

      {/* Filtros */}
      <div className="flex gap-3 mb-4 flex-wrap">
        <input type="date" value={filterFecha} onChange={e => setFilterFecha(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-200" />
        <select value={filterCliente} onChange={e => setFilterCliente(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-200 bg-white">
          <option value="">Todos los clientes</option>
          {clientes.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </select>
        {(filterFecha || filterCliente) && (
          <button onClick={() => { setFilterFecha(""); setFilterCliente(""); }} className="text-xs text-gray-400 hover:text-gray-600 px-2">✕ limpiar</button>
        )}
      </div>

      {/* Tabla pedidos */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mb-8">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-100">
              {["Cliente", "Fecha", "Comida", "Notas", ""].map(h => (
                <th key={h} className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wide">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="text-center py-10 text-sm text-gray-400">Cargando…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={5} className="text-center py-10 text-sm text-gray-400">No hay pedidos</td></tr>
            ) : filtered.map(p => (
              <tr key={p.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                <td className="px-4 py-3 font-medium text-sm">{p.clientes?.nombre ?? "—"}</td>
                <td className="px-4 py-3 text-sm text-gray-600">{fmtDate(p.fecha)}</td>
                <td className="px-4 py-3 text-sm">{p.comida}</td>
                <td className="px-4 py-3 text-xs text-gray-400">{p.notas}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1">
                    <button onClick={() => openEdit(p)} className="px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">✏️</button>
                    <button onClick={() => setConfirmId(p.id)} className="px-2.5 py-1.5 text-xs border border-red-100 text-red-500 rounded-lg hover:bg-red-50 transition-colors">🗑️</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Comidas disponibles */}
      <div>
        <h2 className="text-sm font-medium text-gray-500 mb-3">Comidas disponibles</h2>
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mb-3">
          {comidas.length === 0 ? (
            <div className="text-center py-8 text-sm text-gray-400">No hay comidas cargadas</div>
          ) : comidas.map(c => (
            <div key={c.id} className="flex items-center justify-between px-4 py-3 border-b border-gray-50 last:border-0">
              <span className="text-sm">🍽️ {c.nombre}</span>
              <button onClick={() => deleteComida(c.id)} className="px-2.5 py-1.5 text-xs border border-red-100 text-red-400 rounded-lg hover:bg-red-50 transition-colors">🗑️</button>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            value={nuevaComida}
            onChange={e => setNuevaComida(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") addComida(); }}
            placeholder="Nueva comida…"
            className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-200 max-w-72"
          />
          <button onClick={addComida} className="px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
            + Agregar
          </button>
        </div>
      </div>

      {/* Modal pedido */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editId ? "Editar pedido" : "Nuevo pedido"}>
        <div className="mb-4">
          <label className="block text-xs font-medium text-gray-500 mb-1">Cliente *</label>
          <select value={form.cliente_id} onChange={e => setForm(f => ({...f, cliente_id: parseInt(e.target.value)}))}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-200 bg-white">
            {clientes.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Fecha *</label>
            <input type="date" value={form.fecha} onChange={e => setForm(f => ({...f, fecha: e.target.value}))}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-200" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Comida *</label>
            <select value={form.comida} onChange={e => setForm(f => ({...f, comida: e.target.value}))}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-200 bg-white">
              <option value="">Seleccionar…</option>
              {comidas.map(c => <option key={c.id}>{c.nombre}</option>)}
            </select>
          </div>
        </div>
        <div className="mb-5">
          <label className="block text-xs font-medium text-gray-500 mb-1">Notas / Extras</label>
          <textarea value={form.notas} onChange={e => setForm(f => ({...f, notas: e.target.value}))}
            rows={3} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-200 resize-none"
            placeholder="Sin cebolla, más picante…" />
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
        onConfirm={() => confirmId && deletePedido(confirmId)}
      />
    </div>
  );
}
