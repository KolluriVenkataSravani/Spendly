create function public.create_group(p_name text)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  new_group_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in to create a group.';
  end if;
  if p_name is null or char_length(trim(p_name)) not between 1 and 80 then
    raise exception 'Enter a group name of 1 to 80 characters.';
  end if;

  insert into public.groups (name, created_by)
  values (trim(p_name), auth.uid())
  returning id into new_group_id;

  return new_group_id;
end;
$$;

drop policy if exists "Authenticated users create their own group" on public.groups;
revoke insert on public.groups from authenticated;
revoke all on function public.create_group(text) from public, anon;
grant execute on function public.create_group(text) to authenticated;
