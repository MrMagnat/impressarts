import React, { createContext, useContext, useEffect, useState } from "react";
import { api } from "./api";

interface AuthCtx {
  authed: boolean | null; // null = unknown (checking)
  login: (pw: string) => Promise<void>;
  logout: () => Promise<void>;
}
const Ctx = createContext<AuthCtx>(null as any);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [authed, setAuthed] = useState<boolean | null>(null);

  useEffect(() => {
    api
      .me()
      .then((r) => setAuthed(r.authenticated))
      .catch(() => setAuthed(false));
  }, []);

  const login = async (pw: string) => {
    await api.login(pw);
    setAuthed(true);
  };
  const logout = async () => {
    await api.logout();
    setAuthed(false);
  };

  return <Ctx.Provider value={{ authed, login, logout }}>{children}</Ctx.Provider>;
}
