/**
 * One shared session for the whole app.
 *
 * Previously every component called its own useAuth() and kept its own copy of
 * the user, so signing in on the login page left the header still showing
 * "Sign in" until a reload. A context gives every consumer the same state.
 */
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { authApi } from '../api/endpoints';
import { tokenStore } from '../api/client';
import type { Profile } from '../types';

interface AuthContextValue {
  profile: Profile | null;
  loading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<Profile>;
  logout: () => Promise<void>;
  refresh: () => Promise<Profile | null>;
  /** UI-only gate: the server re-checks every request (BR-45). */
  can: (permission: string) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const queryClient = useQueryClient();

  const refresh = useCallback(async () => {
    if (!tokenStore.access) {
      setProfile(null);
      return null;
    }
    try {
      const p = await authApi.me();
      setProfile(p);
      return p;
    } catch {
      tokenStore.clear();
      setProfile(null);
      return null;
    }
  }, []);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  const login = useCallback(
    async (email: string, password: string) => {
      await authApi.login(email, password);
      const p = await refresh();
      if (!p) throw new Error('Signed in, but the profile could not be loaded');
      return p;
    },
    [refresh],
  );

  const logout = useCallback(async () => {
    await authApi.logout();
    setProfile(null);
    // Never show the next person the previous person's cached data.
    queryClient.clear();
  }, [queryClient]);

  const value = useMemo<AuthContextValue>(
    () => ({
      profile,
      loading,
      isAuthenticated: Boolean(profile),
      login,
      logout,
      refresh,
      can: (permission) => Boolean(profile?.permissions.includes(permission)),
    }),
    [profile, loading, login, logout, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

/** Where a person lands after signing in. */
export function homeFor(profile: Profile): string {
  if (!profile.isStaff) return '/my-bookings';
  if (profile.permissions.includes('CHECK_IN')) return '/staff';
  if (profile.permissions.includes('APPROVE_LEAVE')) return '/staff/approvals';
  if (profile.permissions.includes('MANAGE_ACCOUNTS')) return '/staff/admin/accounts';
  return '/staff/leave';
}
