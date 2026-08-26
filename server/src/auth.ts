import type { FastifyReply, FastifyRequest } from "fastify";
import { getSetting, setSetting } from "./db.js";

const COOKIE = "sklad_sess";

export function defaultPassword(): string {
  return process.env.AUTH_PASSWORD || getSetting("password", "") || "demo";
}

export function ensurePassword(): void {
  if (!getSetting("password", "")) setSetting("password", process.env.AUTH_PASSWORD || "demo");
}

export function checkPassword(pw: string): boolean {
  return pw === (getSetting("password", "") || "demo");
}

export function setSession(reply: FastifyReply): void {
  reply.setCookie(COOKIE, "ok", {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    signed: true,
    maxAge: 60 * 60 * 24 * 7,
  });
}

export function clearSession(reply: FastifyReply): void {
  reply.clearCookie(COOKIE, { path: "/" });
}

export function isAuthed(req: FastifyRequest): boolean {
  const raw = req.cookies[COOKIE];
  if (!raw) return false;
  const un = req.unsignCookie(raw);
  return un.valid && un.value === "ok";
}

/** preHandler guard for protected API routes. */
export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  if (!isAuthed(req)) {
    reply.code(401).send({ error: "unauthorized" });
  }
}
