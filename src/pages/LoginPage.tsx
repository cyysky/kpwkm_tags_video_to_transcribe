import { FormEvent, useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import axios from 'axios'
import { useAuth } from '../auth/AuthContext'

const API_BASE = '/api'

export default function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { login, isAuthenticated } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  if (isAuthenticated) return <Navigate to="/" replace />

  const fromPath = (location.state as { from?: { pathname?: string } } | undefined)?.from?.pathname ?? '/'

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    setLoading(true)

    try {
      const res = await axios.post<{ token: string }>(`${API_BASE}/auth/login`, {
        email: email.trim(),
        password
      })
      login(res.data.token)
      navigate(fromPath, { replace: true })
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.data?.error) {
        setError(err.response.data.error)
      } else {
        setError('Unable to login right now. Please try again.')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10">
      <section className="mx-auto w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <img src="/assets/images/logo.jpeg" alt="App logo" className="mx-auto mb-6 h-16 w-auto" />
        <h1 className="text-center text-2xl font-semibold text-slate-900">Sign in</h1>
        <p className="mt-1 text-center text-sm text-slate-500">Use your account to continue.</p>

        <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">Email</span>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none ring-blue-500 focus:ring-2"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">Password</span>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none ring-blue-500 focus:ring-2"
            />
          </label>
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>

        <p className="mt-5 text-center text-sm text-slate-600">
          No account yet?{' '}
          <Link to="/signup" className="font-medium text-blue-700 hover:underline">
            Sign up
          </Link>
        </p>
      </section>
    </main>
  )
}
