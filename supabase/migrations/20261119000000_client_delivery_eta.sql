-- Tiempo estimado de entrega por cliente, como rango en minutos
-- (ej. 30–40 min). Lo carga el admin al aprobar el pedido en Orders o
-- desde la ficha del cliente; se muestra en la Delivery Sheet (tabla y
-- PDF) y en el Kitchen Display. Ambos null = sin estimado.

alter table public.clients
  add column if not exists delivery_eta_min integer,
  add column if not exists delivery_eta_max integer;

alter table public.clients
  drop constraint if exists clients_delivery_eta_range;
alter table public.clients
  add constraint clients_delivery_eta_range check (
    (delivery_eta_min is null and delivery_eta_max is null)
    or (delivery_eta_min > 0 and delivery_eta_max >= delivery_eta_min)
  );
