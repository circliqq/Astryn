const BASE = process.env.NEXT_PUBLIC_API_URL ?? (typeof window !== "undefined" ? window.location.origin : "http://localhost:4000");

export function getToken(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem("mc_token") ?? "";
}

export function setToken(token: string): void {
  localStorage.setItem("mc_token", token);
}

export function clearToken(): void {
  localStorage.removeItem("mc_token");
}

function parseErrorMessage(text: string): string {
  try {
    const parsed = JSON.parse(text) as { message?: string | string[] };
    if (Array.isArray(parsed.message)) return parsed.message.join(", ");
    if (typeof parsed.message === "string") return parsed.message;
  } catch {
    // Ignore non-JSON error bodies.
  }

  return text;
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;

  try {
    res = await fetch(`${BASE}/api${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${getToken()}`,
        ...(init?.headers as Record<string, string>)
      }
    });
  } catch {
    throw new Error(`Cannot reach the API at ${BASE}. Make sure the backend is running.`);
  }

  if (res.status === 401) {
    if (typeof window !== "undefined") {
      clearToken();
      if (window.location.pathname !== "/login") window.location.href = "/login";
    }
    throw new Error("Session expired. Please log in again.");
  }

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    const message = parseErrorMessage(text);
    throw new Error(message || `Request failed with status ${res.status}.`);
  }

  return res.json() as Promise<T>;
}
