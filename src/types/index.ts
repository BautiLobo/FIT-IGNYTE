export interface Cliente {
  id: number;
  nombre: string;
  tel: string;
  dir: string;
  plan: string;
  comidas: number;
  notas: string;
  created_at?: string;
}

export interface Comida {
  id: number;
  nombre: string;
}

export interface Pedido {
  id: number;
  cliente_id: number;
  fecha: string;
  comida: string;
  notas: string;
  created_at?: string;
  clientes?: { nombre: string };
}

export type Plan = "Básico" | "Estándar" | "Premium" | "Personalizado";
