import { createContext, useContext, useState, useCallback } from 'react'
import { authApi } from '@/api/auth'

const AuthContext = createContext(null)

const SESSION_KEY = 'am-session'

function loadSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function saveSession(data) {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(data))
}

function clearSession() {
  sessionStorage.removeItem(SESSION_KEY)
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => loadSession())
  const [loading, setLoading] = useState(false)

  const login = useCallback(async ({ email, password }) => {
    setLoading(true)
    try {
      const data = await authApi.login({ email, password })
      setUser(data)
      saveSession(data)
      return { ok: true, data }
    } catch (err) {
      return { ok: false, error: err.message }
    } finally {
      setLoading(false)
    }
  }, [])

  const signup = useCallback(async ({ email, password, display_name }) => {
    setLoading(true)
    try {
      const data = await authApi.signup({ email, password, display_name })
      setUser(data)
      saveSession(data)
      return { ok: true, data }
    } catch (err) {
      return { ok: false, error: err.message }
    } finally {
      setLoading(false)
    }
  }, [])

  const logout = useCallback(() => {
    setUser(null)
    clearSession()
  }, [])

  return (
    <AuthContext.Provider value={{ user, loading, login, signup, logout, isAuthed: !!user }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
