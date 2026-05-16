"use client";
import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import type { Pedido } from "@/types";

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function formatDateLabel(s: string) {
  if (!s) return "";
  const d = new Date(s + "T12:00:00");
  const dias = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
  const meses = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  return `${dias[d.getDay()]} ${d.getDate()} de ${meses[d.getMonth()]} de ${d.getFullYear()}`;
}

export default function HoyPage() {
  const [fecha, setFecha] = useState(todayStr());
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchPedidos = useCallback(async (f: string) => {
    setLoading(true);
    const { data } = await supabase
      .from("pedidos")
      .select("*, clientes(nombre)")
      .eq("fecha", f)
      .order("comida");
    setPedidos(data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchPedidos(fecha); }, [fecha, fetchPedidos]);

  // Agrupar por comida
  const grouped: Record<string, Pedido[]> = {};
  pedidos.forEach(p => {
    if (!grouped[p.comida]) grouped[p.comida] = [];
    grouped[p.comida].push(p);
  });

  const totalClientes = new Set(pedidos.map(p => p.cliente_id)).size;

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold">Pedidos del día</h1>
          <p className="text-sm text-gray-400 mt-0.5">{formatDateLabel(fecha)}</p>
        </div>
        <input
          type="date"
          value={fecha}
          onChange={e => setFecha(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-200"
        />
      </div>

      {/* Stats */}
      {!loading && pedidos.length > 0 && (
        <div className="grid grid-cols-3 gap-3 mb-6">
          <div className="bg-gray-50 rounded-xl p-4">
            <p className="text-xs text-gray-400 mb-1">Pedidos totales</p>
            <p className="text-3xl font-semibold">{pedidos.length}</p>
          </div>
          <div className="bg-gray-50 rounded-xl p-4">
            <p className="text-xs text-gray-400 mb-1">Comidas distintas</p>
            <p className="text-3xl font-semibold">{Object.keys(grouped).length}</p>
          </div>
          <div className="bg-gray-50 rounded-xl p-4">
            <p className="text-xs text-gray-400 mb-1">Clientes</p>
            <p className="text-3xl font-semibold">{totalClientes}</p>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-center py-16 text-sm text-gray-400">Cargando…</div>
      ) : pedidos.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 text-center py-16 text-sm text-gray-400">
          No hay pedidos para este día
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Object.entries(grouped).map(([comida, ps]) => (
            <div key={comida} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gray-50">
                <div className="flex items-center gap-2">
                  <span className="text-base">🍽️</span>
                  <span className="font-semibold text-sm">{comida}</span>
                </div>
                <span className="text-xs font-semibold bg-green-100 text-green-700 px-2.5 py-1 rounded-full">
                  {ps.length} {ps.length === 1 ? "pedido" : "pedidos"}
                </span>
              </div>
              <div className="divide-y divide-gray-50">
                {ps.map(p => (
                  <div key={p.id} className="px-4 py-3">
                    <p className="text-sm font-medium text-gray-900">{p.clientes?.nombre ?? "—"}</p>
                    {p.notas && (
                      <p className="text-xs text-gray-400 mt-0.5 flex items-center gap-1">
                        <span>💬</span>{p.notas}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
