import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'

const TOKEN_KEY = 'auth_token'

interface AuthContextValue {
  token: string | null
  isAuthenticated: boolean
  login: (nextToken: string) => void
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY))

  const value = useMemo<AuthContextValue>(
    () => ({
      token,
      isAuthenticated: Boolean(token),
      login: (nextToken: string) => {
        localStorage.setItem(TOKEN_KEY, nextToken)
        setToken(nextToken)
      },
      logout: () => {
        localStorage.removeItem(TOKEN_KEY)
        setToken(null)
      }
    }),
    [token]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return ctx
}
