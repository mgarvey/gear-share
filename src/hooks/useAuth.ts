import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { User } from '@supabase/supabase-js';

interface AuthState {
  user: User | null;
  isReady: boolean;
  isPasswordRecovery: boolean;
}

let authState: AuthState = { user: null, isReady: false, isPasswordRecovery: false };
const listeners = new Set<(state: AuthState) => void>();
let initialized = false;

function setAuthState(next: AuthState) {
  authState = next;
  listeners.forEach((l) => l(authState));
}

function initialize() {
  if (initialized) return;
  initialized = true;

  // Set up listener first — never await inside the callback
  supabase.auth.onAuthStateChange((event, session) => {
    // Synchronous-only: just update state. No DB calls here.
    setAuthState({
      user: session?.user ?? null,
      isReady: true,
      isPasswordRecovery: event === "PASSWORD_RECOVERY" || (authState.isPasswordRecovery && event !== "SIGNED_OUT"),
    });
  });

  // Restore session from storage. isReady flips true only after this completes.
  supabase.auth.getSession()
    .then(({ data: { session } }) => {
      setAuthState({ user: session?.user ?? null, isReady: true, isPasswordRecovery: authState.isPasswordRecovery });
    })
    .catch(() => {
      setAuthState({ user: null, isReady: true, isPasswordRecovery: false });
    });
}

export function useAuth(): AuthState {
  initialize();
  const [state, setState] = useState<AuthState>(authState);

  useEffect(() => {
    // Sync in case state changed between render and effect
    setState(authState);
    const listener = (newState: AuthState) => setState(newState);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  return state;
}
