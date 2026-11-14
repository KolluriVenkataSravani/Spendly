grant usage on schema public to authenticated;

grant select, update on public.profiles to authenticated;
grant select, insert, update on public.categories to authenticated;
grant select, insert, update, delete on public.payment_sources to authenticated;
grant select, insert, update, delete on public.transactions to authenticated;
grant select, insert, update, delete on public.budgets to authenticated;
grant select, insert, update, delete on public.groups to authenticated;
grant select on public.group_memberships to authenticated;
grant select, delete on public.group_invitations to authenticated;
grant select on public.shared_expenses to authenticated;
grant select on public.expense_splits to authenticated;
grant select on public.settlements to authenticated;
