import { supabase } from "../supabase";

export type UserProfile = {
  id: string;
  email: string | null;
  is_admin: boolean;
};

export async function ensureProfile(userId: string, email?: string | null): Promise<void> {
  const { error } = await supabase.from("profiles").upsert(
    {
      id: userId,
      email: email ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" }
  );
  if (error) throw error;
}

export async function fetchUserProfile(userId: string): Promise<UserProfile | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, is_admin")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    id: data.id,
    email: data.email,
    is_admin: Boolean(data.is_admin),
  };
}

export async function fetchIsAdmin(userId: string): Promise<boolean> {
  const profile = await fetchUserProfile(userId);
  return profile?.is_admin === true;
}
