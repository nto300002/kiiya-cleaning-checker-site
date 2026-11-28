import { redirect } from "next/navigation";
import { getActiveSession } from "@/lib/idle-session";

export type AuthenticatedUser = {
  userId: string;
  displayName: string;
  email: string;
  fullName: string | null;
};

export type ChatGPTUser = AuthenticatedUser;

export async function getAuthenticatedUser(): Promise<AuthenticatedUser | null> {
  const session = await getActiveSession();
  if (!session) return null;
  const fullName = session.displayName && session.displayName !== session.email ? session.displayName : null;
  return {
    userId: session.userId,
    displayName: session.displayName || session.email || session.userId,
    email: session.email,
    fullName,
  };
}

export async function getChatGPTUser(): Promise<AuthenticatedUser | null> {
  return getAuthenticatedUser();
}

export async function requireAuthenticatedUser(returnTo: string): Promise<AuthenticatedUser> {
  const user = await getAuthenticatedUser();
  if (user) return user;
  redirect(appSessionPath(returnTo));
}

export async function requireChatGPTUser(returnTo: string): Promise<AuthenticatedUser> {
  return requireAuthenticatedUser(returnTo);
}

export function appSessionPath(returnTo: string): string {
  return `/session?return_to=${encodeURIComponent(safeRelativeReturnPath(returnTo))}`;
}

export function googleSignInPath(returnTo: string): string {
  return `/auth/google?return_to=${encodeURIComponent(safeRelativeReturnPath(returnTo))}`;
}

export function chatGPTSignInPath(returnTo: string): string {
  return appSessionPath(returnTo);
}

export function signOutPath(): string {
  return "/auth/logout";
}

export function chatGPTSignOutPath(): string {
  return signOutPath();
}

export function safeRelativeReturnPath(value: string): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  let url: URL;
  try {
    url = new URL(value, "https://app.local");
  } catch {
    return "/";
  }
  if (url.origin !== "https://app.local") return "/";
  if (
    url.pathname === "/signin-with-chatgpt" ||
    url.pathname === "/signout-with-chatgpt" ||
    url.pathname === "/callback" ||
    url.pathname === "/session" ||
    url.pathname.startsWith("/session/") ||
    url.pathname === "/auth" ||
    url.pathname.startsWith("/auth/") ||
    url.pathname.startsWith("/api/")
  ) {
    return "/";
  }
  return `${url.pathname}${url.search}${url.hash}`;
}
