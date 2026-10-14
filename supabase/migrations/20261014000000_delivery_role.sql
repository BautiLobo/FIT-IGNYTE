-- Rol "delivery" para empleados del panel admin.
--
-- Admin sigue siendo is_admin() (email en admin_emails). Un empleado
-- delivery es un usuario de Auth con app_metadata.role = 'delivery'
-- (lo setea la Edge Function manage-staff con la service key; el usuario no
-- puede cambiarse su propio app_metadata). En el panel solo ve la Delivery
-- Sheet + Kitchen/Chef Display, y la base le da solo lo que eso necesita:
--   - leer clients (el resto de tablas de la Delivery Sheet ya tienen
--     SELECT abierto);
--   - escribir en checklist solo las claves del KDS (k_*) y del Chef
--     Display (c_*). El "Done" de entrega (d_*) queda para admin.

create or replace function public.is_delivery()
returns boolean
language sql
stable
as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'delivery';
$$;

drop policy if exists "select_delivery_clients" on public.clients;
create policy "select_delivery_clients" on public.clients
  for select to authenticated
  using (public.is_delivery());

drop policy if exists "insert_delivery_checklist" on public.checklist;
create policy "insert_delivery_checklist" on public.checklist
  for insert to authenticated
  with check (public.is_delivery() and (key like 'k\_%' or key like 'c\_%'));

drop policy if exists "update_delivery_checklist" on public.checklist;
create policy "update_delivery_checklist" on public.checklist
  for update to authenticated
  using (public.is_delivery() and (key like 'k\_%' or key like 'c\_%'))
  with check (public.is_delivery() and (key like 'k\_%' or key like 'c\_%'));
