-- Dos tipos de rechazo de un pedido nuevo (Orders → Reject):
--   'waitlist' = cupo lleno, queda en lista de espera
--   'zone'     = todavía no llegamos a su zona
-- NULL = rechazos viejos (antes de esto): el MP los muestra como 'zone' con
-- el texto fijo y NO muestra `note` (esas notas eran internas).
-- `note` (inglés) y `note_zh` (chino) pasan a ser el mensaje que ve el
-- cliente según el idioma de su WeChat; vacío = el texto por defecto del MP.
alter table public.new_orders
  add column if not exists reject_type text
  check (reject_type in ('waitlist', 'zone'));
alter table public.new_orders
  add column if not exists note_zh text;
