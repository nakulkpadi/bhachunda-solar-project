import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.117.2";

export type AppRole = "admin" | "data_entry" | "legal" | "finance" | "viewer";
export const GOOGLE_REFRESH_TOKEN_KEY = "google_drive_oauth_refresh_token";
export const GOOGLE_DRIVE_SCOPE = Deno.env.get("GOOGLE_DRIVE_OAUTH_SCOPE") || "https://www.googleapis.com/auth/drive";

let cachedAccessToken: { value: string; expiresAt: number } | null = null;

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function encryptionKey(): Promise<CryptoKey> {
  const encoded = Deno.env.get("DRIVE_TOKEN_ENCRYPTION_KEY");
  if (!encoded) throw new Error("Drive token encryption key is not configured.");
  const bytes = fromBase64Url(encoded);
  if (bytes.length !== 32) throw new Error("Drive token encryption key must contain exactly 32 bytes.");
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptSecret(value: string): Promise<string> {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const key = await encryptionKey();
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, new TextEncoder().encode(value)));
  return `${base64Url(nonce)}.${base64Url(encrypted)}`;
}

export async function decryptSecret(ciphertext: string): Promise<string> {
  const [nonceEncoded, payloadEncoded, ...extra] = ciphertext.split(".");
  if (!nonceEncoded || !payloadEncoded || extra.length) throw new Error("Stored Drive credential is invalid.");
  const key = await encryptionKey();
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64Url(nonceEncoded) },
    key,
    fromBase64Url(payloadEncoded)
  );
  return new TextDecoder().decode(plaintext);
}

export async function sha256Text(value: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function serverSecretKey(): string | undefined {
  const direct = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SECRET_KEY");
  if (direct) return direct;
  const encoded = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (!encoded) return undefined;
  try {
    const values = Object.values(JSON.parse(encoded) as Record<string, string>);
    return values.find((value) => typeof value === "string" && value.length > 0);
  } catch {
    return undefined;
  }
}

export function createAdminClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const key = serverSecretKey();
  if (!url || !key) throw new Error("Server configuration is incomplete.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export function callbackUrl(): string {
  // Hosted Supabase exposes SUPABASE_URL; self-hosted deployments may expose
  // an internal gateway URL there and provide SUPABASE_PUBLIC_URL separately.
  const url = Deno.env.get("SUPABASE_PUBLIC_URL") || Deno.env.get("SUPABASE_URL");
  if (!url) throw new Error("Server configuration is incomplete.");
  return `${url.replace(/\/$/, "")}/functions/v1/drive-oauth-callback`;
}

export function googleClientId(): string {
  const clientId = Deno.env.get("GOOGLE_OAUTH_CLIENT_ID");
  if (!clientId) throw new Error("Google OAuth client ID is not configured.");
  return clientId;
}

function googleClientSecret(): string {
  const secret = Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET");
  if (!secret) throw new Error("Google OAuth client secret is not configured.");
  return secret;
}

export function buildGoogleAuthorizeUrl(state: string): string {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: googleClientId(),
    redirect_uri: callbackUrl(),
    response_type: "code",
    scope: GOOGLE_DRIVE_SCOPE,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state
  }).toString();
  return url.toString();
}

export async function exchangeGoogleAuthorizationCode(code: string): Promise<string> {
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: googleClientId(),
      client_secret: googleClientSecret(),
      redirect_uri: callbackUrl(),
      grant_type: "authorization_code"
    })
  });
  if (!tokenResponse.ok) throw new Error("Google Drive authorization exchange failed.");
  const token = await tokenResponse.json() as { refresh_token?: string };
  if (!token.refresh_token) throw new Error("Google did not issue an offline refresh token. Reconnect Drive and approve the consent prompt.");
  return token.refresh_token;
}

export async function getOAuthAccessToken(admin: SupabaseClient): Promise<string> {
  if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now() + 60_000) return cachedAccessToken.value;
  const { data: stored, error: storedError } = await admin
    .from("integration_secrets")
    .select("ciphertext")
    .eq("key", GOOGLE_REFRESH_TOKEN_KEY)
    .maybeSingle();
  if (storedError || !stored?.ciphertext) throw new Error("Personal Google Drive is not connected yet.");
  const refreshToken = await decryptSecret(stored.ciphertext);
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: googleClientId(),
      client_secret: googleClientSecret(),
      refresh_token: refreshToken,
      grant_type: "refresh_token"
    })
  });
  if (!tokenResponse.ok) throw new Error("Google Drive access needs to be reconnected by an administrator.");
  const token = await tokenResponse.json() as { access_token?: string; expires_in?: number };
  if (!token.access_token) throw new Error("Google Drive did not return an access token.");
  cachedAccessToken = { value: token.access_token, expiresAt: Date.now() + Math.max(60, token.expires_in ?? 3000) * 1000 };
  return cachedAccessToken.value;
}

export async function requireRole(request: Request, roles: AppRole[]): Promise<{ admin: SupabaseClient; userId: string }> {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) throw new Error("Authentication is required.");
  const admin = createAdminClient();
  const { data: userResult, error: userError } = await admin.auth.getUser(authorization.slice("Bearer ".length));
  if (userError || !userResult.user) throw new Error("Authentication is invalid or expired.");
  const { data: profile, error: profileError } = await admin.from("profiles").select("role,is_active").eq("id", userResult.user.id).maybeSingle();
  const role = profile?.role as AppRole | undefined;
  if (profileError || !profile?.is_active || !role || !roles.includes(role)) throw new Error("Your role cannot perform this action.");
  return { admin, userId: userResult.user.id };
}
