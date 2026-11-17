create table public.purchase_scenarios (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 120),
  amount numeric(14, 2) not null check (amount > 0),
  planned_on date not null,
  category_id uuid references public.categories(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id)
);

create table public.life_event_plans (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 100),
  target_amount numeric(14, 2) not null check (target_amount > 0),
  target_on date not null,
  amount_set_aside numeric(14, 2) not null default 0 check (amount_set_aside >= 0),
  status text not null default 'active' check (status in ('active', 'completed', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.life_event_costs (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.life_event_plans(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 120),
  amount numeric(14, 2) not null check (amount > 0),
  planned_on date not null,
  category_id uuid references public.categories(id) on delete set null,
  status text not null default 'planned' check (status in ('planned', 'recorded')),
  recorded_transaction_id uuid unique references public.transactions(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'planned' and recorded_transaction_id is null) or (status = 'recorded' and recorded_transaction_id is not null))
);

alter table public.transactions
  add column life_event_cost_id uuid unique references public.life_event_costs(id) on delete set null;

create index purchase_scenarios_owner_date_idx on public.purchase_scenarios (owner_id, planned_on);
create index life_event_plans_owner_status_idx on public.life_event_plans (owner_id, status, target_on);
create index life_event_costs_plan_date_idx on public.life_event_costs (plan_id, planned_on);

create trigger purchase_scenarios_touch_updated_at before update on public.purchase_scenarios
for each row execute function public.touch_updated_at();
create trigger life_event_plans_touch_updated_at before update on public.life_event_plans
for each row execute function public.touch_updated_at();
create trigger life_event_costs_touch_updated_at before update on public.life_event_costs
for each row execute function public.touch_updated_at();

alter table public.purchase_scenarios enable row level security;
alter table public.life_event_plans enable row level security;
alter table public.life_event_costs enable row level security;

create policy "Users manage their purchase scenarios"
on public.purchase_scenarios for all to authenticated
using (owner_id = auth.uid())
with check (
  owner_id = auth.uid()
  and (category_id is null or exists (
    select 1 from public.categories c where c.id = category_id and c.owner_id = auth.uid()
  ))
);

create policy "Users manage their life event plans"
on public.life_event_plans for all to authenticated
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

create policy "Users manage costs for their life event plans"
on public.life_event_costs for all to authenticated
using (exists (
  select 1 from public.life_event_plans p where p.id = plan_id and p.owner_id = auth.uid()
))
with check (
  exists (select 1 from public.life_event_plans p where p.id = plan_id and p.owner_id = auth.uid())
  and (category_id is null or exists (
    select 1 from public.categories c where c.id = category_id and c.owner_id = auth.uid()
  ))
  and (
    (status = 'planned' and recorded_transaction_id is null)
    or (status = 'recorded' and exists (
      select 1 from public.transactions t
      where t.id = recorded_transaction_id and t.owner_id = auth.uid()
    ))
  )
);

grant select, insert, update, delete on public.purchase_scenarios to authenticated;
grant select, insert, update, delete on public.life_event_plans to authenticated;
grant select, insert, update, delete on public.life_event_costs to authenticated;
grant select, insert, update, delete on public.transactions to authenticated;

create function public.record_life_event_cost(
  p_cost_id uuid,
  p_actual_amount numeric,
  p_occurred_on date,
  p_payment_method text,
  p_payment_source_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  selected_cost record;
  transaction_id uuid;
  owner_timezone text;
begin
  if auth.uid() is null then raise exception 'Sign in to record this life-event cost.'; end if;
  if p_actual_amount is null or p_actual_amount <= 0 or p_actual_amount > 999999999999.99 then
    raise exception 'Enter a valid actual amount above zero.';
  end if;
  if p_occurred_on is null then
    raise exception 'The recorded purchase date cannot be in the future.';
  end if;
  if p_payment_method not in ('cash', 'credit_card', 'debit_card', 'upi') then
    raise exception 'Choose a supported payment method.';
  end if;

  select c.*, p.owner_id
    into selected_cost
  from public.life_event_costs c
  join public.life_event_plans p on p.id = c.plan_id
  where c.id = p_cost_id and p.owner_id = auth.uid()
  for update of c;
  if not found then raise exception 'This planned cost is unavailable.'; end if;
  if selected_cost.status <> 'planned' or selected_cost.recorded_transaction_id is not null then
    raise exception 'This cost has already been recorded.';
  end if;
  select timezone into owner_timezone from public.profiles where id = auth.uid();
  if p_occurred_on > (now() at time zone owner_timezone)::date then
    raise exception 'The recorded purchase date cannot be in the future.';
  end if;
  if selected_cost.category_id is not null and not exists (
    select 1 from public.categories c where c.id = selected_cost.category_id and c.owner_id = auth.uid()
  ) then raise exception 'Choose one of your own categories or leave it uncategorized.'; end if;
  if p_payment_source_id is not null and not exists (
    select 1 from public.payment_sources s
    where s.id = p_payment_source_id and s.owner_id = auth.uid()
      and s.kind = p_payment_method and not s.archived
  ) then raise exception 'Choose an active payment source matching the payment method.'; end if;

  insert into public.transactions (
    owner_id, title, amount, type, payment_method, category_id, payment_source_id,
    occurred_at, life_event_cost_id, notes
  )
  values (
    auth.uid(), selected_cost.title, round(p_actual_amount, 2), 'expense', p_payment_method,
    selected_cost.category_id, p_payment_source_id,
    (p_occurred_on::timestamp + interval '12 hours') at time zone owner_timezone,
    selected_cost.id,
    'Recorded from life-event plan'
  )
  returning id into transaction_id;

  update public.life_event_costs
  set status = 'recorded', recorded_transaction_id = transaction_id
  where id = selected_cost.id;
  return transaction_id;
end;
$$;

create function public.reset_life_event_cost_after_transaction_delete()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if old.life_event_cost_id is not null then
    update public.life_event_costs
    set status = 'planned', recorded_transaction_id = null
    where id = old.life_event_cost_id and recorded_transaction_id = old.id;
  end if;
  return old;
end;
$$;

create trigger transactions_reset_life_event_cost
before delete on public.transactions
for each row execute function public.reset_life_event_cost_after_transaction_delete();

revoke all on function public.record_life_event_cost(uuid, numeric, date, text, uuid) from public, anon;
revoke all on function public.reset_life_event_cost_after_transaction_delete() from public, anon, authenticated;
grant execute on function public.record_life_event_cost(uuid, numeric, date, text, uuid) to authenticated;

create or replace function public.process_due_recurring_payments()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null then raise exception 'Sign in to view recurring entries.'; end if;
  return 0;
end;
$$;

create function public.record_recurring_occurrence(
  p_schedule_id uuid,
  p_occurrence_on date,
  p_actual_amount numeric,
  p_paid_on date,
  p_payment_method text,
  p_payment_source_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  selected_schedule public.recurring_payments%rowtype;
  owner_timezone text;
  transaction_id uuid;
begin
  if auth.uid() is null then raise exception 'Sign in to record this payment.'; end if;
  select * into selected_schedule
  from public.recurring_payments
  where id = p_schedule_id and owner_id = auth.uid() and enabled
  for update;
  if not found then raise exception 'This recurring schedule is unavailable or paused.'; end if;
  if p_occurrence_on is distinct from selected_schedule.next_due_on then
    raise exception 'This payment is no longer the next scheduled occurrence. Refresh the calendar and try again.';
  end if;
  if p_actual_amount is null or p_actual_amount <= 0 or p_actual_amount > 999999999999.99 then
    raise exception 'Enter a valid actual amount above zero.';
  end if;
  if p_payment_method not in ('cash', 'credit_card', 'debit_card', 'upi') then
    raise exception 'Choose a supported payment method.';
  end if;
  if p_paid_on is null then raise exception 'Choose the date the payment was made.'; end if;
  select timezone into owner_timezone from public.profiles where id = auth.uid();
  if p_paid_on > (now() at time zone owner_timezone)::date then
    raise exception 'The payment date cannot be in the future.';
  end if;
  if p_occurrence_on > (now() at time zone owner_timezone)::date then
    raise exception 'This recurring payment is not due yet.';
  end if;
  if p_payment_source_id is not null and not exists (
    select 1 from public.payment_sources s
    where s.id = p_payment_source_id and s.owner_id = auth.uid()
      and s.kind = p_payment_method and not s.archived
  ) then raise exception 'Choose an active payment source matching the payment method.'; end if;

  insert into public.transactions (
    owner_id, title, amount, type, payment_method, category_id, payment_source_id,
    occurred_at, recurring_payment_id, recurring_occurrence_date, notes
  )
  values (
    auth.uid(), selected_schedule.title, round(p_actual_amount, 2), selected_schedule.type,
    p_payment_method, selected_schedule.category_id, p_payment_source_id,
    (p_paid_on::timestamp + interval '12 hours') at time zone owner_timezone,
    selected_schedule.id, p_occurrence_on, 'Recorded from recurring schedule'
  )
  on conflict (recurring_payment_id, recurring_occurrence_date) do nothing
  returning id into transaction_id;

  if transaction_id is null then
    select id into transaction_id from public.transactions
    where recurring_payment_id = selected_schedule.id and recurring_occurrence_date = p_occurrence_on;
  end if;

  update public.recurring_payments
  set next_due_on = public.next_recurring_date(
    selected_schedule.frequency, p_occurrence_on,
    selected_schedule.anchor_day, selected_schedule.anchor_month
  )
  where id = selected_schedule.id;
  return transaction_id;
end;
$$;

revoke all on function public.record_recurring_occurrence(uuid, date, numeric, date, text, uuid) from public, anon;
grant execute on function public.record_recurring_occurrence(uuid, date, numeric, date, text, uuid) to authenticated;
