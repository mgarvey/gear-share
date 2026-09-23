import { supabase } from "@/integrations/supabase/client";

export const db = supabase;

type FunctionOptions = Parameters<typeof supabase.functions.invoke>[1];

function functionStatus(error: unknown) {
  const context = (error as { context?: unknown } | null)?.context;
  return context instanceof Response ? context.status : undefined;
}

async function currentAccessToken(forceRefresh = false) {
  if (forceRefresh) {
    const refreshed = await supabase.auth.refreshSession();
    if (refreshed.error || !refreshed.data.session?.access_token) throw new Error("Your session expired. Sign in again and retry.");
    return refreshed.data.session.access_token;
  }
  const current = await supabase.auth.getSession();
  if (current.error || !current.data.session?.access_token) throw new Error("Sign in before using this feature.");
  if ((current.data.session.expires_at ?? 0) * 1000 <= Date.now() + 30_000) return currentAccessToken(true);
  return current.data.session.access_token;
}

export async function invokeAuthenticatedFunction(name: string, options: FunctionOptions) {
  const invoke = (accessToken: string) => supabase.functions.invoke(name, {
    ...options,
    headers: { ...options?.headers, Authorization: `Bearer ${accessToken}` },
  });
  let result = await invoke(await currentAccessToken());
  if (result.error && functionStatus(result.error) === 401) result = await invoke(await currentAccessToken(true));
  return result;
}

export const recoveryRpc = (
  name: string,
  args: Record<string, unknown>,
) =>
  db.rpc(name as never, args as never) as unknown as Promise<{
    data: any;
    error: any;
  }>;

const RECOVERY_RPC_ID_BATCH_SIZE = 500;

export async function fetchRecoveryRowsInIdBatches(
  name: string,
  ids: string[],
  batchSize = RECOVERY_RPC_ID_BATCH_SIZE,
): Promise<any[]> {
  const rows: any[] = [];
  for (let offset = 0; offset < ids.length; offset += batchSize) {
    const { data, error } = await recoveryRpc(name, {
      target_ids: ids.slice(offset, offset + batchSize),
    });
    if (error) throw error;
    rows.push(...(data ?? []));
  }
  return rows;
}
