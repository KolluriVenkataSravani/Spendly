create extension if not exists pgcrypto with schema extensions;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 100),
  currency text not null default 'INR' check (currency ~ '^[A-Z]{3}$'),
  monthly_budget numeric(14, 2) not null default 0 check (monthly_budget >= 0),
  starting_balance numeric(14, 2) not null default 0 check (starting_balance >= 0),
  timezone text not null default 'UTC' check (char_length(timezone) <= 80),
  onboarding_complete boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 40),
  icon text not null default '✦' check (char_length(icon) <= 8),
  color text not null default '#5B9B74' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  unique (owner_id, name)
);

create table public.payment_sources (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  label text not null check (char_length(trim(label)) between 1 and 60),
  kind text not null check (kind in ('credit_card', 'debit_card', 'upi')),
  issuer text check (issuer is null or char_length(issuer) <= 60),
  last_four text check (last_four is null or last_four ~ '^[0-9]{4}$'),
  masked_identifier text check (masked_identifier is null or char_length(masked_identifier) <= 80),
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((kind = 'upi' and last_four is null and issuer is null) or kind <> 'upi'),
  unique (owner_id, label)
);

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 140),
  amount numeric(14, 2) not null check (amount > 0),
  type text not null check (type in ('expense', 'income')),
  payment_method text not null check (payment_method in ('cash', 'credit_card', 'debit_card', 'upi')),
  category_id uuid references public.categories(id) on delete set null,
  payment_source_id uuid references public.payment_sources(id) on delete set null,
  occurred_at timestamptz not null,
  notes text check (notes is null or char_length(notes) <= 1000),
  receipt_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (receipt_path is null or char_length(receipt_path) <= 500)
);

create table public.budgets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  month_start date not null check (extract(day from month_start) = 1),
  category_id uuid references public.categories(id) on delete set null,
  amount numeric(14, 2) not null check (amount > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index budgets_overall_unique on public.budgets (owner_id, month_start) where category_id is null;
create unique index budgets_category_unique on public.budgets (owner_id, month_start, category_id) where category_id is not null;

create table public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 80),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.group_memberships (
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create table public.group_invitations (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  invited_by uuid not null references auth.users(id) on delete cascade,
  email text not null check (char_length(email) <= 254),
  token_hash text not null unique,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.shared_expenses (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  paid_by uuid references auth.users(id) on delete set null,
  title text not null check (char_length(trim(title)) between 1 and 140),
  amount numeric(14, 2) not null check (amount > 0),
  occurred_at timestamptz not null,
  category_id uuid references public.categories(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.expense_splits (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.shared_expenses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  amount_owed numeric(14, 2) not null check (amount_owed >= 0),
  created_at timestamptz not null default now(),
  unique (expense_id, user_id)
);

create table public.settlements (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  payer_id uuid not null references auth.users(id) on delete cascade,
  payee_id uuid not null references auth.users(id) on delete cascade,
  amount numeric(14, 2) not null check (amount > 0),
  paid_at timestamptz not null default now(),
  note text check (note is null or char_length(note) <= 500),
  created_at timestamptz not null default now(),
  check (payer_id <> payee_id)
);

create index transactions_owner_date_idx on public.transactions (owner_id, occurred_at desc);
create index transactions_category_idx on public.transactions (category_id);
create index transactions_payment_source_idx on public.transactions (payment_source_id);
create index budgets_owner_month_idx on public.budgets (owner_id, month_start desc);
create index group_memberships_user_idx on public.group_memberships (user_id, group_id);
create index group_invitations_group_pending_idx on public.group_invitations (group_id, expires_at) where accepted_at is null;
create index shared_expenses_group_date_idx on public.shared_expenses (group_id, occurred_at desc);
create index expense_splits_user_idx on public.expense_splits (user_id, expense_id);
create index settlements_group_date_idx on public.settlements (group_id, paid_at desc);

create function public.touch_updated_at()
returns trigger language plpgsql set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_touch_updated_at before update on public.profiles
for each row execute function public.touch_updated_at();
create trigger payment_sources_touch_updated_at before update on public.payment_sources
for each row execute function public.touch_updated_at();
create trigger transactions_touch_updated_at before update on public.transactions
for each row execute function public.touch_updated_at();
create trigger budgets_touch_updated_at before update on public.budgets
for each row execute function public.touch_updated_at();
create trigger groups_touch_updated_at before update on public.groups
for each row execute function public.touch_updated_at();

create function public.seed_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', ''));

  insert into public.categories (owner_id, name, icon, color, is_default) values
    (new.id, 'Food & dining', '🍜', '#D18460', true),
    (new.id, 'Transport', '↗', '#6F83B1', true),
    (new.id, 'Shopping', '✦', '#9A78A9', true),
    (new.id, 'Bills & utilities', '⌂', '#D6A451', true),
    (new.id, 'Health', '✚', '#5A9B9B', true),
    (new.id, 'Entertainment', '♫', '#C16B7B', true),
    (new.id, 'Travel', '✈', '#668C9B', true),
    (new.id, 'Home', '⌂', '#7D897F', true),
    (new.id, 'Income', '↙', '#5B9B74', true);
  return new;
end;
$$;
create trigger auth_user_seed after insert on auth.users
for each row execute function public.seed_new_user();

create function public.is_group_member(p_group_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.group_memberships
    where group_id = p_group_id and user_id = auth.uid()
  );
$$;

create function public.can_view_group_profile(p_user_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.group_memberships mine
    join public.group_memberships theirs on theirs.group_id = mine.group_id
    where mine.user_id = auth.uid() and theirs.user_id = p_user_id
  );
$$;

create function public.is_group_owner(p_group_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.group_memberships
    where group_id = p_group_id and user_id = auth.uid() and role = 'owner'
  );
$$;

create function public.add_group_creator()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.group_memberships (group_id, user_id, role)
  values (new.id, new.created_by, 'owner');
  return new;
end;
$$;
create trigger groups_add_creator after insert on public.groups
for each row execute function public.add_group_creator();

create function public.promote_group_owner()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  next_owner uuid;
begin
  if old.role = 'owner' then
    select user_id into next_owner
    from public.group_memberships
    where group_id = old.group_id
    order by joined_at, user_id
    limit 1;
    if next_owner is not null then
      update public.group_memberships set role = 'owner'
      where group_id = old.group_id and user_id = next_owner;
    else
      delete from public.groups where id = old.group_id;
    end if;
  end if;
  return old;
end;
$$;
create trigger group_memberships_promote_owner after delete on public.group_memberships
for each row execute function public.promote_group_owner();

create function public.create_group_invitation(p_group_id uuid, p_email text)
returns text language plpgsql security definer set search_path = public, extensions
as $$
declare
  raw_token text;
begin
  if auth.uid() is null or not public.is_group_member(p_group_id) then
    raise exception 'You must be a group member to invite someone.';
  end if;
  if p_email is null or length(trim(p_email)) < 3 or length(p_email) > 254 or p_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Enter a valid email address.';
  end if;
  raw_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.group_invitations (group_id, invited_by, email, token_hash, expires_at)
  values (
    p_group_id,
    auth.uid(),
    lower(trim(p_email)),
    encode(extensions.digest(convert_to(raw_token, 'UTF8'), 'sha256'), 'hex'),
    now() + interval '7 days'
  );
  return raw_token;
end;
$$;

create function public.accept_group_invitation(p_token text)
returns uuid language plpgsql security definer set search_path = public, extensions
as $$
declare
  invitation public.group_invitations%rowtype;
  account_email text;
begin
  if auth.uid() is null or p_token is null or length(p_token) > 128 then
    raise exception 'Sign in with the invited email address to accept this invitation.';
  end if;
  account_email := lower(coalesce(auth.jwt() ->> 'email', ''));
  select * into invitation
  from public.group_invitations
  where token_hash = encode(extensions.digest(convert_to(p_token, 'UTF8'), 'sha256'), 'hex')
  for update;
  if not found or invitation.accepted_at is not null or invitation.expires_at <= now() then
    raise exception 'This invitation is invalid, already used, or expired.';
  end if;
  if account_email <> lower(invitation.email) then
    raise exception 'Sign in with the email address this invitation was sent to.';
  end if;
  insert into public.group_memberships (group_id, user_id, role)
  values (invitation.group_id, auth.uid(), 'member')
  on conflict (group_id, user_id) do nothing;
  update public.group_invitations set accepted_at = now() where id = invitation.id;
  return invitation.group_id;
end;
$$;

create function public.create_shared_expense(
  p_group_id uuid,
  p_title text,
  p_amount numeric,
  p_paid_by uuid,
  p_occurred_at timestamptz,
  p_category_id uuid,
  p_splits jsonb
)
returns uuid language plpgsql security definer set search_path = public
as $$
declare
  new_expense_id uuid;
  split_total numeric(16, 2);
  split_count integer;
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
  if not exists (
    select 1 from public.group_memberships
    where group_id = p_group_id and user_id = p_paid_by
  ) then
    raise exception 'The payer must be a member of this group.';
  end if;
  if p_category_id is not null and not exists (
    select 1 from public.categories
    where id = p_category_id and owner_id = auth.uid()
  ) then
    raise exception 'Choose one of your own categories or leave it uncategorized.';
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
  ) then
    raise exception 'Every split must have a valid amount and a current group member.';
  end if;
  if split_total <> round(p_amount, 2) then
    raise exception 'The expense split must add up to the total amount.';
  end if;

  insert into public.shared_expenses (group_id, created_by, paid_by, title, amount, occurred_at, category_id)
  values (p_group_id, auth.uid(), p_paid_by, trim(p_title), round(p_amount, 2), p_occurred_at, p_category_id)
  returning id into new_expense_id;
  insert into public.expense_splits (expense_id, user_id, amount_owed)
  select new_expense_id, (entry ->> 'user_id')::uuid, round((entry ->> 'amount_owed')::numeric, 2)
  from jsonb_array_elements(p_splits) entry;
  return new_expense_id;
end;
$$;

create function public.delete_category(p_category_id uuid)
returns void language plpgsql security definer set search_path = public
as $$
declare
  target public.categories%rowtype;
begin
  if auth.uid() is null then raise exception 'Sign in to manage categories.'; end if;
  select * into target from public.categories
  where id = p_category_id and owner_id = auth.uid()
  for update;
  if not found then raise exception 'Category not found.'; end if;
  if target.is_default then raise exception 'Default categories cannot be deleted.'; end if;
  update public.transactions set category_id = null
  where owner_id = auth.uid() and category_id = p_category_id;
  delete from public.budgets
  where owner_id = auth.uid() and category_id = p_category_id;
  delete from public.categories where id = p_category_id;
end;
$$;

create function public.record_settlement(
  p_group_id uuid,
  p_payee_id uuid,
  p_amount numeric,
  p_paid_at timestamptz,
  p_note text
)
returns uuid language plpgsql security definer set search_path = public
as $$
declare
  payer_balance numeric(16, 2);
  payee_balance numeric(16, 2);
  new_settlement_id uuid;
begin
  if auth.uid() is null or not public.is_group_member(p_group_id) then
    raise exception 'You must be a group member to record a settlement.';
  end if;
  perform 1 from public.groups where id = p_group_id for update;
  if p_payee_id = auth.uid() or not exists (
    select 1 from public.group_memberships
    where group_id = p_group_id and user_id = p_payee_id
  ) then
    raise exception 'Choose another current member of this group.';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount > 999999999999.99 then
    raise exception 'Enter a valid positive settlement amount.';
  end if;
  select
    coalesce((select sum(s.amount_owed)
      from public.expense_splits s
      join public.shared_expenses e on e.id = s.expense_id
      where e.group_id = p_group_id and s.user_id = auth.uid()), 0)
    - coalesce((select sum(e.amount) from public.shared_expenses e
      where e.group_id = p_group_id and e.paid_by = auth.uid()), 0)
    - coalesce((select sum(s.amount) from public.settlements s
      where s.group_id = p_group_id and s.payer_id = auth.uid()), 0)
    + coalesce((select sum(s.amount) from public.settlements s
      where s.group_id = p_group_id and s.payee_id = auth.uid()), 0)
    into payer_balance;
  select
    coalesce((select sum(s.amount_owed)
      from public.expense_splits s
      join public.shared_expenses e on e.id = s.expense_id
      where e.group_id = p_group_id and s.user_id = p_payee_id), 0)
    - coalesce((select sum(e.amount) from public.shared_expenses e
      where e.group_id = p_group_id and e.paid_by = p_payee_id), 0)
    - coalesce((select sum(s.amount) from public.settlements s
      where s.group_id = p_group_id and s.payer_id = p_payee_id), 0)
    + coalesce((select sum(s.amount) from public.settlements s
      where s.group_id = p_group_id and s.payee_id = p_payee_id), 0)
    into payee_balance;
  if payer_balance <= 0 or payee_balance >= 0 or p_amount > least(payer_balance, abs(payee_balance)) then
    raise exception 'Settlement amount exceeds the current balance between these members.';
  end if;

  insert into public.settlements (group_id, payer_id, payee_id, amount, paid_at, note)
  values (p_group_id, auth.uid(), p_payee_id, round(p_amount, 2), coalesce(p_paid_at, now()), p_note)
  returning id into new_settlement_id;
  return new_settlement_id;
end;
$$;

create function public.delete_my_account()
returns void language plpgsql security definer set search_path = public, auth, storage
as $$
declare
  account_id uuid := auth.uid();
begin
  if account_id is null then raise exception 'You must be signed in to delete your account.'; end if;
  delete from storage.objects where bucket_id = 'receipts' and name like account_id::text || '/%';
  delete from public.settlements where payer_id = account_id or payee_id = account_id;
  delete from public.shared_expenses
  where created_by = account_id
     or paid_by = account_id
     or id in (select expense_id from public.expense_splits where user_id = account_id);
  delete from public.group_invitations where invited_by = account_id;
  delete from public.group_memberships where user_id = account_id;
  delete from auth.users where id = account_id;
end;
$$;

alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.payment_sources enable row level security;
alter table public.transactions enable row level security;
alter table public.budgets enable row level security;
alter table public.groups enable row level security;
alter table public.group_memberships enable row level security;
alter table public.group_invitations enable row level security;
alter table public.shared_expenses enable row level security;
alter table public.expense_splits enable row level security;
alter table public.settlements enable row level security;

create policy "Profiles are visible to self and group members"
on public.profiles for select to authenticated
using (id = auth.uid() or public.can_view_group_profile(id));
create policy "Users update their own profile"
on public.profiles for update to authenticated
using (id = auth.uid()) with check (id = auth.uid());

create policy "Users manage their own categories"
on public.categories for select to authenticated using (owner_id = auth.uid());
create policy "Users create their own categories"
on public.categories for insert to authenticated with check (owner_id = auth.uid());
create policy "Users update their own categories"
on public.categories for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "Users manage their own payment sources"
on public.payment_sources for all to authenticated
using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "Users manage their own transactions"
on public.transactions for all to authenticated
using (owner_id = auth.uid()) with check (
  owner_id = auth.uid()
  and (category_id is null or exists (select 1 from public.categories c where c.id = category_id and c.owner_id = auth.uid()))
  and (payment_source_id is null or exists (select 1 from public.payment_sources p where p.id = payment_source_id and p.owner_id = auth.uid() and p.kind = payment_method))
);
create policy "Users manage their own budgets"
on public.budgets for all to authenticated
using (owner_id = auth.uid()) with check (
  owner_id = auth.uid()
  and (category_id is null or exists (select 1 from public.categories c where c.id = category_id and c.owner_id = auth.uid()))
);

create policy "Members can view their groups"
on public.groups for select to authenticated using (public.is_group_member(id));
create policy "Authenticated users create their own group"
on public.groups for insert to authenticated with check (created_by = auth.uid());
create policy "Group owners update group details"
on public.groups for update to authenticated using (public.is_group_owner(id)) with check (public.is_group_owner(id));
create policy "Group owners delete their groups"
on public.groups for delete to authenticated using (public.is_group_owner(id));

create policy "Members can view group membership"
on public.group_memberships for select to authenticated using (public.is_group_member(group_id));
create policy "Members can view group invitations"
on public.group_invitations for select to authenticated using (public.is_group_member(group_id));
create policy "Owners can revoke pending invitations"
on public.group_invitations for delete to authenticated using (public.is_group_owner(group_id));

create policy "Members can view shared expenses"
on public.shared_expenses for select to authenticated using (public.is_group_member(group_id));
create policy "Members view splits in their groups"
on public.expense_splits for select to authenticated
using (exists (select 1 from public.shared_expenses e where e.id = expense_id and public.is_group_member(e.group_id)));

create policy "Members can view group settlements"
on public.settlements for select to authenticated using (public.is_group_member(group_id));

revoke all on function public.create_group_invitation(uuid, text) from public, anon;
revoke all on function public.accept_group_invitation(text) from public, anon;
revoke all on function public.create_shared_expense(uuid, text, numeric, uuid, timestamptz, uuid, jsonb) from public, anon;
revoke all on function public.record_settlement(uuid, uuid, numeric, timestamptz, text) from public, anon;
revoke all on function public.delete_category(uuid) from public, anon;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.create_group_invitation(uuid, text) to authenticated;
grant execute on function public.accept_group_invitation(text) to authenticated;
grant execute on function public.create_shared_expense(uuid, text, numeric, uuid, timestamptz, uuid, jsonb) to authenticated;
grant execute on function public.record_settlement(uuid, uuid, numeric, timestamptz, text) to authenticated;
grant execute on function public.delete_category(uuid) to authenticated;
grant execute on function public.delete_my_account() to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy "Users view their own receipts"
on storage.objects for select to authenticated
using (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "Users upload their own receipts"
on storage.objects for insert to authenticated
with check (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "Users update their own receipts"
on storage.objects for update to authenticated
using (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text)
with check (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "Users delete their own receipts"
on storage.objects for delete to authenticated
using (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text);
