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
    <main
      className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10"
      style={{
        background:
          'radial-gradient(60% 50% at 18% 22%, #dbe5ff 0%, rgba(219,229,255,0) 60%), radial-gradient(55% 45% at 85% 20%, #ffe3ec 0%, rgba(255,227,236,0) 60%), radial-gradient(50% 55% at 82% 85%, #d6f0ff 0%, rgba(214,240,255,0) 60%), radial-gradient(60% 55% at 15% 88%, #fff3d4 0%, rgba(255,243,212,0) 60%), linear-gradient(180deg, #f6f7fb 0%, #eef1f8 100%)'
      }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-60 mix-blend-multiply"
        style={{
          backgroundImage: 'radial-gradient(rgba(16,24,40,.035) 1px, transparent 1px)',
          backgroundSize: '3px 3px'
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -left-[120px] -top-[120px] h-[520px] w-[520px] rounded-full bg-[#a5b9ff] opacity-55 blur-[60px]"
      />
      <div aria-hidden className="pointer-events-none absolute -right-[80px] -top-[80px] h-[420px] w-[420px] rounded-full bg-[#ffb8c8] opacity-45 blur-[60px]" />
      <div aria-hidden className="pointer-events-none absolute bottom-[-120px] right-[8%] h-[380px] w-[380px] rounded-full bg-[#9be0ff] opacity-50 blur-[60px]" />
      <div aria-hidden className="pointer-events-none absolute bottom-[-140px] left-[4%] h-[440px] w-[440px] rounded-full bg-[#ffe39c] opacity-40 blur-[60px]" />
      <section className="relative mx-auto w-full max-w-md rounded-2xl border border-white/40 bg-white p-8 shadow-2xl">
        <img src="/assets/images/logo.png" alt="App logo" className="mx-auto mb-6 h-32 w-auto" />
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
