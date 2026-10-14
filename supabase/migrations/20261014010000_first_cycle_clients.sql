-- Clientes en su primer ciclo (nunca renovaron), para marcar en la Delivery
-- Sheet la primera comida de un cliente nuevo.
--
-- "Nuevo" = sin ninguna renovación pagada y aplicada en payments: la misma
-- regla que usa el panel para contar renovaciones (renewalCountByClient).
-- No se puede derivar de meal_selections porque al renovar se reescriben
-- las comidas y la fecha más temprana pasa a ser el inicio del ciclo nuevo.
--
-- payments es solo admin; el rol delivery necesita este dato pero no los
-- montos, así que la función es SECURITY DEFINER y devuelve solo ids.

create or replace function public.first_cycle_client_ids()
returns setof integer
language sql
stable
security definer
set search_path to 'public'
as $$
  select c.id
  from public.clients c
  where (public.is_admin() or public.is_delivery())
    and not exists (
      select 1 from public.payments p
      where p.client_id = c.id
        and p.type = 'renewal'
        and p.status = 'paid'
        and p.applied is true
    );
$$;

revoke all on function public.first_cycle_client_ids() from public, anon;
grant execute on function public.first_cycle_client_ids() to authenticated;
