function authHeaders(anonKey, accessToken) {
  const headers = {
    "Content-Type": "application/json",
    apikey: anonKey,
  };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  return headers;
}

function parseAuthError(data, status) {
  const msg =
    data?.error_description ||
    data?.msg ||
    data?.message ||
    data?.error ||
    `HTTP ${status}`;
  return new Error(String(msg));
}

export async function signInWithPassword(url, anonKey, email, password) {
  const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: authHeaders(anonKey),
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw parseAuthError(data, res.status);
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    userId: data.user?.id,
    email: data.user?.email ?? email,
  };
}

export async function refreshAccessToken(url, anonKey, refreshToken) {
  const res = await fetch(`${url}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: authHeaders(anonKey),
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw parseAuthError(data, res.status);
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? refreshToken,
    userId: data.user?.id,
    email: data.user?.email ?? null,
  };
}

export async function signOutRemote(url, anonKey, accessToken) {
  try {
    await fetch(`${url}/auth/v1/logout`, {
      method: "POST",
      headers: authHeaders(anonKey, accessToken),
    });
  } catch {
    /* local session cleared either way */
  }
}
