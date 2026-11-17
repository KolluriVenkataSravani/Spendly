alter table public.transactions
  add column shared_expense_id uuid references public.shared_expenses(id) on delete set null,
  add column recurring_payment_id uuid,
  add column recurring_occurrence_date date,
  add constraint transactions_recurring_occurrence_unique
    unique (recurring_payment_id, recurring_occurrence_date);

create table public.recurring_payments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 140),
  amount numeric(14, 2) not null check (amount > 0),
  type text not null check (type in ('expense', 'income')),
  payment_method text not null check (payment_method in ('cash', 'credit_card', 'debit_card', 'upi')),
  category_id uuid references public.categories(id) on delete set null,
  payment_source_id uuid references public.payment_sources(id) on delete set null,
  frequency text not null check (frequency in ('weekly', 'monthly', 'yearly')),
  next_due_on date not null,
  anchor_day smallint not null check (anchor_day between 1 and 31),
  anchor_month smallint not null check (anchor_month between 1 and 12),
  autopay boolean not null default false,
  enabled boolean not null default true,
  notes text check (notes is null or char_length(notes) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (payment_source_id is null or payment_method <> 'cash')
);

alter table public.transactions
  add constraint transactions_recurring_payment_fk
    foreign key (recurring_payment_id) references public.recurring_payments(id) on delete set null;

create table public.user_notifications (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  body text not null check (char_length(body) between 1 and 500),
  target_page text not null default 'Budgets' check (target_page in ('Overview', 'Transactions', 'Budgets', 'Analytics', 'Shared expenses', 'Card Vault', 'Settings')),
  dedupe_key text not null check (char_length(dedupe_key) <= 180),
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (owner_id, dedupe_key)
);

alter table public.transactions drop constraint if exists transactions_payment_method_check;
alter table public.transactions add constraint transactions_payment_method_check
  check (payment_method in ('cash', 'credit_card', 'debit_card', 'upi', 'shared'));

create unique index transactions_shared_expense_unique on public.transactions (owner_id, shared_expense_id) where shared_expense_id is not null;
create index transactions_recurring_payment_idx on public.transactions (owner_id, recurring_payment_id, recurring_occurrence_date) where recurring_payment_id is not null;
create index recurring_payments_due_idx on public.recurring_payments (owner_id, next_due_on) where enabled;
create index user_notifications_unread_idx on public.user_notifications (owner_id, created_at desc) where read_at is null;

create trigger recurring_payments_touch_updated_at before update on public.recurring_payments
for each row execute function public.touch_updated_at();

alter table public.transactions enable row level security;
alter table public.recurring_payments enable row level security;
alter table public.user_notifications enable row level security;

create policy "Users manage their own recurring payments"
on public.recurring_payments for select to authenticated using (owner_id = auth.uid());
create policy "Users update their own recurring payment status"
on public.recurring_payments for update to authenticated
using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "Users delete their own recurring payments"
on public.recurring_payments for delete to authenticated using (owner_id = auth.uid());

create policy "Users view their own notifications"
on public.user_notifications for select to authenticated using (owner_id = auth.uid());
create policy "Users update their own notifications"
on public.user_notifications for update to authenticated
using (owner_id = auth.uid()) with check (owner_id = auth.uid());

grant select, delete on public.recurring_payments to authenticated;
grant update (enabled) on public.recurring_payments to authenticated;
grant select on public.user_notifications to authenticated;
grant update (read_at) on public.user_notifications to authenticated;

create or replace function public.refresh_budget_notifications(p_owner_id uuid, p_date date)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_timezone text;
  v_month_start date;
  v_month_end date;
  spent numeric(16, 2);
  target_amount numeric(14, 2);
  category_budget record;
  category_spent numeric(16, 2);
begin
  select timezone into v_timezone from public.profiles where id = p_owner_id;
  if v_timezone is null then return; end if;
  v_month_start := date_trunc('month', p_date::timestamp)::date;
  v_month_end := (v_month_start + interval '1 month')::date;

  select coalesce(sum(t.amount), 0)::numeric(16, 2)
    into spent
  from public.transactions t
  where t.owner_id = p_owner_id
    and t.type = 'expense'
    and t.occurred_at >= (v_month_start::timestamp at time zone v_timezone)
    and t.occurred_at < (v_month_end::timestamp at time zone v_timezone);

  select coalesce(
    (select b.amount from public.budgets b
      where b.owner_id = p_owner_id and b.month_start = v_month_start and b.category_id is null),
    (select p.monthly_budget from public.profiles p where p.id = p_owner_id)
  ) into target_amount;

  if target_amount > 0 and spent >= target_amount then
    insert into public.user_notifications (owner_id, title, body, target_page, dedupe_key)
    values (p_owner_id, 'Monthly budget reached',
      format('You have spent %s of your %s monthly target.', spent, target_amount),
      'Budgets', format('budget:%s:overall:exceeded', v_month_start))
    on conflict (owner_id, dedupe_key) do nothing;
  elsif target_amount > 0 and spent >= target_amount * 0.8 then
    insert into public.user_notifications (owner_id, title, body, target_page, dedupe_key)
    values (p_owner_id, 'Monthly budget getting close',
      format('You have spent %s of your %s monthly target.', spent, target_amount),
      'Budgets', format('budget:%s:overall:approaching', v_month_start))
    on conflict (owner_id, dedupe_key) do nothing;
  end if;

  for category_budget in
    select b.category_id, b.amount, c.name
    from public.budgets b
    join public.categories c on c.id = b.category_id
    where b.owner_id = p_owner_id and b.month_start = v_month_start and b.category_id is not null
  loop
    select coalesce(sum(t.amount), 0)::numeric(16, 2)
      into category_spent
    from public.transactions t
    where t.owner_id = p_owner_id
      and t.type = 'expense'
      and t.category_id = category_budget.category_id
      and t.occurred_at >= (v_month_start::timestamp at time zone v_timezone)
      and t.occurred_at < (v_month_end::timestamp at time zone v_timezone);

    if category_spent >= category_budget.amount then
      insert into public.user_notifications (owner_id, title, body, target_page, dedupe_key)
      values (p_owner_id, format('%s budget reached', category_budget.name),
        format('You have spent %s of your %s category target.', category_spent, category_budget.amount),
        'Budgets', format('budget:%s:category:%s:exceeded', v_month_start, category_budget.category_id))
      on conflict (owner_id, dedupe_key) do nothing;
    elsif category_spent >= category_budget.amount * 0.8 then
      insert into public.user_notifications (owner_id, title, body, target_page, dedupe_key)
      values (p_owner_id, format('%s budget getting close', category_budget.name),
        format('You have spent %s of your %s category target.', category_spent, category_budget.amount),
        'Budgets', format('budget:%s:category:%s:approaching', v_month_start, category_budget.category_id))
      on conflict (owner_id, dedupe_key) do nothing;
    end if;
  end loop;
end;
$$;

create function public.refresh_budget_notifications_for_transaction()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  owner_timezone text;
begin
  if tg_op <> 'INSERT' then
    select timezone into owner_timezone from public.profiles where id = old.owner_id;
    if owner_timezone is not null then
      perform public.refresh_budget_notifications(old.owner_id, (old.occurred_at at time zone owner_timezone)::date);
    end if;
  end if;
  if tg_op <> 'DELETE' then
    select timezone into owner_timezone from public.profiles where id = new.owner_id;
    if owner_timezone is not null then
      perform public.refresh_budget_notifications(new.owner_id, (new.occurred_at at time zone owner_timezone)::date);
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger transactions_refresh_budget_notifications
after insert or update or delete on public.transactions
for each row execute function public.refresh_budget_notifications_for_transaction();

create function public.refresh_budget_notifications_for_budget()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if tg_op <> 'INSERT' then
    perform public.refresh_budget_notifications(old.owner_id, old.month_start);
  end if;
  if tg_op <> 'DELETE' then
    perform public.refresh_budget_notifications(new.owner_id, new.month_start);
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger budgets_refresh_notifications
after insert or update or delete on public.budgets
for each row execute function public.refresh_budget_notifications_for_budget();

create function public.refresh_budget_notifications_for_profile()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.monthly_budget is distinct from old.monthly_budget or new.timezone is distinct from old.timezone then
    perform public.refresh_budget_notifications(new.id, (now() at time zone new.timezone)::date);
  end if;
  return new;
end;
$$;

create trigger profiles_refresh_budget_notifications
after update on public.profiles
for each row execute function public.refresh_budget_notifications_for_profile();

do $$
declare
  profile_row record;
begin
  for profile_row in select id, timezone from public.profiles loop
    perform public.refresh_budget_notifications(
      profile_row.id,
      (now() at time zone profile_row.timezone)::date
    );
  end loop;
end;
$$;

create function public.set_notification_read(p_notification_id uuid)
returns void language plpgsql security definer set search_path = pg_catalog, public
as $$
begin
  update public.user_notifications
  set read_at = now()
  where id = p_notification_id and owner_id = auth.uid() and read_at is null;
end;
$$;

create function public.set_all_notifications_read()
returns void language plpgsql security definer set search_path = pg_catalog, public
as $$
begin
  update public.user_notifications
  set read_at = now()
  where owner_id = auth.uid() and read_at is null;
end;
$$;

create function public.create_recurring_payment(
  p_title text,
  p_amount numeric,
  p_type text,
  p_payment_method text,
  p_category_id uuid,
  p_payment_source_id uuid,
  p_frequency text,
  p_next_due_on date,
  p_autopay boolean,
  p_notes text
)
returns uuid language plpgsql security definer set search_path = pg_catalog, public
as $$
declare
  new_schedule_id uuid;
begin
  if auth.uid() is null then raise exception 'Sign in to create a recurring entry.'; end if;
  if p_title is null or char_length(trim(p_title)) not between 1 and 140 then raise exception 'Enter a description of 1 to 140 characters.'; end if;
  if p_amount is null or p_amount <= 0 or p_amount > 999999999999.99 then raise exception 'Enter a valid positive amount.'; end if;
  if p_type not in ('expense', 'income') then raise exception 'Choose expense or income.'; end if;
  if p_payment_method not in ('cash', 'credit_card', 'debit_card', 'upi') then raise exception 'Choose a supported payment method.'; end if;
  if p_frequency not in ('weekly', 'monthly', 'yearly') then raise exception 'Choose a supported recurring frequency.'; end if;
  if p_next_due_on is null then raise exception 'Choose the next due date.'; end if;
  if p_notes is not null and char_length(p_notes) > 1000 then raise exception 'Notes must be 1,000 characters or fewer.'; end if;
  if p_category_id is not null and not exists (select 1 from public.categories where id = p_category_id and owner_id = auth.uid()) then
    raise exception 'Choose one of your own categories.';
  end if;
  if p_payment_source_id is not null and not exists (
    select 1 from public.payment_sources
    where id = p_payment_source_id and owner_id = auth.uid() and kind = p_payment_method and not archived
  ) then raise exception 'Choose an active payment source matching the payment method.'; end if;

  insert into public.recurring_payments (
    owner_id, title, amount, type, payment_method, category_id, payment_source_id,
    frequency, next_due_on, anchor_day, anchor_month, autopay, notes
  )
  values (
    auth.uid(), trim(p_title), round(p_amount, 2), p_type, p_payment_method, p_category_id, p_payment_source_id,
    p_frequency, p_next_due_on, extract(day from p_next_due_on)::smallint,
    extract(month from p_next_due_on)::smallint, coalesce(p_autopay, false), p_notes
  )
  returning id into new_schedule_id;
  return new_schedule_id;
end;
$$;

create function public.next_recurring_date(p_frequency text, p_due_on date, p_anchor_day smallint, p_anchor_month smallint)
returns date language plpgsql immutable set search_path = pg_catalog
as $$
declare
  next_month date;
  final_day integer;
begin
  if p_frequency = 'weekly' then return p_due_on + 7; end if;
  if p_frequency = 'monthly' then
    next_month := (date_trunc('month', p_due_on::timestamp) + interval '1 month')::date;
    final_day := extract(day from (next_month + interval '1 month - 1 day'))::integer;
    return next_month + least(p_anchor_day, final_day) - 1;
  end if;
  next_month := make_date(extract(year from p_due_on)::integer + 1, p_anchor_month, 1);
  final_day := extract(day from (next_month + interval '1 month - 1 day'))::integer;
  return next_month + least(p_anchor_day, final_day) - 1;
end;
$$;

create function public.process_due_recurring_payments()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  schedule record;
  due_on date;
  occurrence_count integer;
  total_recorded integer := 0;
begin
  if auth.uid() is null then raise exception 'Sign in to process recurring entries.'; end if;

  for schedule in
    select rp.*, p.timezone
    from public.recurring_payments rp
    join public.profiles p on p.id = rp.owner_id
    where rp.owner_id = auth.uid()
      and rp.enabled
      and rp.next_due_on <= (now() at time zone p.timezone)::date
    order by rp.next_due_on
    for update of rp skip locked
  loop
    due_on := schedule.next_due_on;
    occurrence_count := 0;
    while due_on <= (now() at time zone schedule.timezone)::date and occurrence_count < 100 loop
      insert into public.transactions (
        owner_id, title, amount, type, payment_method, category_id, payment_source_id,
        occurred_at, notes, recurring_payment_id, recurring_occurrence_date
      )
      values (
        schedule.owner_id, schedule.title, schedule.amount, schedule.type,
        schedule.payment_method, schedule.category_id, schedule.payment_source_id,
        (due_on::timestamp + interval '12 hours') at time zone schedule.timezone,
        schedule.notes, schedule.id, due_on
      )
      on conflict (recurring_payment_id, recurring_occurrence_date) do nothing;
      if found then total_recorded := total_recorded + 1; end if;
      due_on := public.next_recurring_date(schedule.frequency, due_on, schedule.anchor_day, schedule.anchor_month);
      occurrence_count := occurrence_count + 1;
    end loop;
    update public.recurring_payments set next_due_on = due_on where id = schedule.id;
  end loop;
  return total_recorded;
end;
$$;

create or replace function public.create_shared_expense(
  p_group_id uuid,
  p_title text,
  p_amount numeric,
  p_paid_by uuid,
  p_occurred_at timestamptz,
  p_category_id uuid,
  p_splits jsonb
)
returns uuid language plpgsql security definer set search_path = pg_catalog, public
as $$
declare
  new_expense_id uuid;
  split_total numeric(16, 2);
  split_count integer;
  own_category_name text;
begin
  if auth.uid() is null or not public.is_group_member(p_group_id) then
    raise exception 'You must be a group member to add a shared expense.';
  end if;
  perform 1 from public.groups where id = p_group_id for update;
  if p_title is null or length(trim(p_title)) not between 1 and 140 then
    raise exception 'Enter an expense description of 1 to 140 characters.';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount > 999999999999.99 then
    raise exception 'Enter a valid positive expense amount.';
  end if;
  if not exists (select 1 from public.group_memberships where group_id = p_group_id and user_id = p_paid_by) then
    raise exception 'The payer must be a member of this group.';
  end if;
  if p_category_id is not null then
    select name into own_category_name from public.categories where id = p_category_id and owner_id = auth.uid();
    if own_category_name is null then raise exception 'Choose one of your own categories or leave it uncategorized.'; end if;
  end if;
  if jsonb_typeof(p_splits) <> 'array' or jsonb_array_length(p_splits) < 1 then
    raise exception 'Add at least one member to the split.';
  end if;
  select count(*), coalesce(sum(round((entry ->> 'amount_owed')::numeric, 2)), 0)
    into split_count, split_total
  from jsonb_array_elements(p_splits) entry;
  if split_count <> (select count(distinct entry ->> 'user_id') from jsonb_array_elements(p_splits) entry) then
    raise exception 'Each group member can only appear once in the split.';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_splits) entry
    where (entry ->> 'amount_owed') is null
       or (entry ->> 'amount_owed')::numeric < 0
       or not exists (
         select 1 from public.group_memberships m
         where m.group_id = p_group_id and m.user_id = (entry ->> 'user_id')::uuid
       )
  ) then raise exception 'Every split must have a valid amount and a current group member.'; end if;
  if split_total <> round(p_amount, 2) then raise exception 'The expense split must add up to the total amount.'; end if;

  insert into public.shared_expenses (group_id, created_by, paid_by, title, amount, occurred_at, category_id)
  values (p_group_id, auth.uid(), p_paid_by, trim(p_title), round(p_amount, 2), p_occurred_at, p_category_id)
  returning id into new_expense_id;
  insert into public.expense_splits (expense_id, user_id, amount_owed)
  select new_expense_id, (entry ->> 'user_id')::uuid, round((entry ->> 'amount_owed')::numeric, 2)
  from jsonb_array_elements(p_splits) entry;

  insert into public.transactions (
    owner_id, title, amount, type, payment_method, category_id, occurred_at,
    shared_expense_id, notes
  )
  select
    (entry ->> 'user_id')::uuid,
    trim(p_title),
    round((entry ->> 'amount_owed')::numeric, 2),
    'expense',
    'shared',
    (select c.id from public.categories c
      where c.owner_id = (entry ->> 'user_id')::uuid and c.name = own_category_name
      limit 1),
    p_occurred_at,
    new_expense_id,
    'Shared expense · ' || trim(p_title)
  from jsonb_array_elements(p_splits) entry
  where (entry ->> 'amount_owed')::numeric > 0
  on conflict (owner_id, shared_expense_id) where shared_expense_id is not null do nothing;

  return new_expense_id;
end;
$$;

revoke all on function public.set_notification_read(uuid) from public, anon;
revoke all on function public.set_all_notifications_read() from public, anon;
revoke all on function public.create_recurring_payment(text, numeric, text, text, uuid, uuid, text, date, boolean, text) from public, anon;
revoke all on function public.process_due_recurring_payments() from public, anon;
revoke all on function public.refresh_budget_notifications(uuid, date) from public, anon, authenticated;
revoke all on function public.refresh_budget_notifications_for_transaction() from public, anon, authenticated;
revoke all on function public.refresh_budget_notifications_for_budget() from public, anon, authenticated;
revoke all on function public.refresh_budget_notifications_for_profile() from public, anon, authenticated;
revoke all on function public.next_recurring_date(text, date, smallint, smallint) from public, anon, authenticated;
revoke all on function public.create_shared_expense(uuid, text, numeric, uuid, timestamptz, uuid, jsonb) from public, anon;

grant execute on function public.set_notification_read(uuid) to authenticated;
grant execute on function public.set_all_notifications_read() to authenticated;
grant execute on function public.create_recurring_payment(text, numeric, text, text, uuid, uuid, text, date, boolean, text) to authenticated;
grant execute on function public.process_due_recurring_payments() to authenticated;
grant execute on function public.create_shared_expense(uuid, text, numeric, uuid, timestamptz, uuid, jsonb) to authenticated;
grant usage on schema public to authenticated;
