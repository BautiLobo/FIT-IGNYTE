-- Códigos de descuento de un solo uso, generados desde la pestaña Referrals
-- del panel. Solo valen para RENOVACIONES en el mini-program -- los códigos
-- de coach (tabla coaches) siguen siendo solo para altas nuevas y no se
-- aceptan acá.
--
-- Un código se "gasta" cuando el pago que lo usó pasa a status='paid'
-- (trigger más abajo), no al crear el pago: un pago abandonado no lo quema.

create table if not exists public.discount_codes (
  id                bigint generated always as identity primary key,
  code              text not null unique,
  kind              text not null check (kind in ('percent', 'amount')),
  value             numeric not null check (value > 0),
  note              text not null default '',
  created_at        timestamptz not null default now(),
  used_at           timestamptz,
  used_by_client_id integer,
  used_out_trade_no text,
  constraint discount_codes_percent_max check (kind <> 'percent' or value <= 100)
);

alter table public.discount_codes enable row level security;

-- Solo el panel (admin). El mini-program NO lee la tabla directo (con la
-- anon key se podrían listar todos los códigos): valida con
-- check_discount_code() y el cobro lo recalcula create-payment.
create policy select_admin_discount_codes on public.discount_codes for select using (is_admin());
create policy write_admin_discount_codes  on public.discount_codes for insert with check (is_admin());
create policy update_admin_discount_codes on public.discount_codes for update using (is_admin()) with check (is_admin());
create policy delete_admin_discount_codes on public.discount_codes for delete using (is_admin());

alter table public.payments add column if not exists discount_code text not null default '';

-- Chequeo de un código puntual para mostrar el descuento antes de pagar.
-- Devuelve solo ese código (nunca la lista) y solo si sigue sin usar.
create or replace function public.check_discount_code(p_code text)
returns json
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select json_build_object('valid', true, 'kind', kind, 'value', value)
       from discount_codes
      where code = upper(trim(p_code)) and used_at is null),
    json_build_object('valid', false)
  );
$$;

revoke all on function public.check_discount_code(text) from public;
grant execute on function public.check_discount_code(text) to anon, authenticated;

-- Marca el código como usado cuando el pago se confirma. `used_at is null`
-- en el WHERE: si dos pagos con el mismo código llegaran a confirmarse,
-- queda registrado el primero.
create or replace function public.mark_discount_code_used()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'paid' and coalesce(old.status, '') <> 'paid' and coalesce(new.discount_code, '') <> '' then
    update discount_codes
       set used_at = now(), used_by_client_id = new.client_id, used_out_trade_no = new.out_trade_no
     where code = new.discount_code and used_at is null;
  end if;
  return new;
end;
$$;

drop trigger if exists payments_mark_discount_code_used on public.payments;
create trigger payments_mark_discount_code_used
  after update of status on public.payments
  for each row execute function public.mark_discount_code_used();
