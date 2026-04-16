import { useState, useRef, useEffect, useCallback, ChangeEvent, DragEvent } from 'react'
import axios from 'axios'
import { Button } from './components/ui/button'
import { Card } from './components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './components/ui/table'

const API_BASE = '/api'

interface SrtSegment {
  start: number
  end: number
  text: string
}

interface TranscriptionFile {
  id?: string
  name: string
  originalName: string
  jobId?: string | null
  status: 'processing' | 'complete'
  srtUrl?: string
}

interface Progress {
  status: string
  totalChunks?: number
  completed?: number
  percent?: number
  currentChunk?: string
}

interface Log {
  time: string
  message: string
}

interface AppProps {
  onLogout?: () => void
}

type TabType = 'transcribe' | 'srt-edit' | 'files'

const tabConfig: Array<{ id: TabType; label: string; hint: string }> = [
  { id: 'transcribe', label: 'New transcription', hint: 'Upload court media' },
  { id: 'srt-edit', label: 'Transcript editor', hint: 'Edit .srt files' },
  { id: 'files', label: 'Library', hint: 'All jobs & exports' }
]

function IconUpload(props: { className?: string }) {
  return (
    <svg className={props.className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M12 16V4M12 4l-4 4M12 4l4 4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 20h16" strokeLinecap="round" />
    </svg>
  )
}

function IconDoc(props: { className?: string }) {
  return (
    <svg className={props.className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" strokeLinejoin="round" />
      <path d="M14 3v5h5" strokeLinejoin="round" />
    </svg>
  )
}

function IconFolder(props: { className?: string }) {
  return (
    <svg className={props.className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" strokeLinejoin="round" />
    </svg>
  )
}

function IconFilm(props: { className?: string }) {
  return (
    <svg className={props.className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <path d="M7 5v14M17 5v14" strokeLinecap="round" />
    </svg>
  )
}

function parseSrt(srtContent: string | null): SrtSegment[] {
  if (!srtContent) return []
  const segments: SrtSegment[] = []
  const blocks = srtContent.trim().split(/\n\n+/)
  for (const block of blocks) {
    const lines = block.split('\n')
    if (lines.length >= 3) {
      const timeLine = lines[1]
      const timeMatch = timeLine.match(/(\d{2}):(\d{2}):(\d{2}),(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2}),(\d{3})/)
      if (timeMatch) {
        const start = parseInt(timeMatch[1]) * 3600 + parseInt(timeMatch[2]) * 60 + parseInt(timeMatch[3]) + parseInt(timeMatch[4]) / 1000
        const end = parseInt(timeMatch[5]) * 3600 + parseInt(timeMatch[6]) * 60 + parseInt(timeMatch[7]) + parseInt(timeMatch[8]) / 1000
        segments.push({ start, end, text: lines.slice(2).join('\n') })
      }
    }
  }
  return segments
}

function formatTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

function formatSrtTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  const ms = Math.floor((seconds % 1) * 1000)
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')},${ms.toString().padStart(3, '0')}`
}

function App({ onLogout }: AppProps) {
  const [activeTab, setActiveTab] = useState<TabType>('transcribe')
  const [files, setFiles] = useState<TranscriptionFile[]>([])
  const [currentFile, setCurrentFile] = useState<TranscriptionFile | null>(null)
  const [jobId, setJobId] = useState<string | null>(null)
  const [progress, setProgress] = useState<Progress | null>(null)
  const [logs, setLogs] = useState<Log[]>([])
  const [srtContent, setSrtContent] = useState<string | null>(null)
  const [srtSegments, setSrtSegments] = useState<SrtSegment[]>([])
  const [currentSubtitle, setCurrentSubtitle] = useState<SrtSegment | null>(null)
  const [editingSubtitle, setEditingSubtitle] = useState<SrtSegment | null>(null)
  const [isEditing, setIsEditing] = useState(false)
  const [timeInput, setTimeInput] = useState('00:00:00')
  const [srtEditContent, setSrtEditContent] = useState('')
  const [srtEditFilename, setSrtEditFilename] = useState('')
  const [srtSaving, setSrtSaving] = useState(false)

  const videoRef = useRef<HTMLVideoElement>(null)
  const eventSourceRef = useRef<EventSource | null>(null)
  const mediaInputRef = useRef<HTMLInputElement>(null)
  const srtInputRef = useRef<HTMLInputElement>(null)

  const addLog = useCallback((message: string): void => {
    const time = new Date().toLocaleTimeString('en-US', { hour12: false })
    setLogs(prev => [...prev.slice(-50), { time, message }])
  }, [])

  const loadSrtContent = useCallback(async (filename: string): Promise<void> => {
    try {
      const res = await axios.get<string>(`${API_BASE}/download/${filename}`)
      setSrtContent(res.data)
      setSrtSegments(parseSrt(res.data))
    } catch (err) {
      console.error('Failed to load SRT:', err)
    }
  }, [])

  const fetchFiles = useCallback(async (): Promise<void> => {
    try {
      const res = await axios.get<{ files: TranscriptionFile[] }>(`${API_BASE}/files`)
      const fileList = res.data.files || []
      setFiles(fileList)
      if (fileList.length > 0 && !currentFile) {
        const completeFile = fileList.find(f => f.status === 'complete')
        if (completeFile) {
          setCurrentFile(completeFile)
          loadSrtContent(completeFile.name)
        }
      }
    } catch (err) {
      console.error('Failed to fetch files:', err)
    }
  }, [currentFile, loadSrtContent])

  useEffect(() => {
    fetchFiles()
    return () => {
      if (eventSourceRef.current) eventSourceRef.current.close()
    }
  }, [fetchFiles])

  useEffect(() => {
    setSrtSegments(parseSrt(srtContent))
  }, [srtContent])

  const handleTimeUpdate = useCallback(() => {
    if (!videoRef.current || srtSegments.length === 0) return
    const currentTime = videoRef.current.currentTime
    const subtitle = srtSegments.find(seg => currentTime >= seg.start && currentTime <= seg.end)
    setCurrentSubtitle(subtitle || null)
    setTimeInput(formatTimestamp(currentTime))
  }, [srtSegments])

  const handleFileUpload = async (file: File): Promise<void> => {
    const formData = new FormData()
    formData.append('file', file)
    addLog(`Uploading ${file.name}...`)
    try {
      const res = await axios.post<{ jobId: string; outputFile: string }>(`${API_BASE}/transcribe`, formData)
      const newJobId = res.data.jobId
      setJobId(newJobId)
      setProgress({ status: 'starting', percent: 0, completed: 0, totalChunks: 0 })
      const newFile: TranscriptionFile = { id: newJobId, name: res.data.outputFile, originalName: file.name, status: 'processing' }
      setFiles(prev => [newFile, ...prev])
      setCurrentFile(newFile)
      addLog(`Job started: ${newJobId}`)

      if (eventSourceRef.current) eventSourceRef.current.close()
      eventSourceRef.current = new EventSource(`${API_BASE}/progress/${newJobId}`)
      eventSourceRef.current.onmessage = (e: MessageEvent) => {
        const data = JSON.parse(e.data)
        if (data.type === 'status') {
          addLog(data.message)
          setProgress(prev => ({ ...(prev ?? { status: '' }), status: data.message }))
        } else if (data.type === 'chunks-created') {
          setProgress(prev => ({ ...(prev ?? { status: 'processing' }), totalChunks: data.count }))
        } else if (data.type === 'chunk-complete') {
          const percent = Math.round((data.chunkIndex / data.totalChunks) * 100)
          setProgress(prev => ({
            ...(prev ?? { status: 'processing' }),
            completed: data.chunkIndex,
            percent,
            currentChunk: `${data.start}s - ${data.end}s`
          }))
        } else if (data.type === 'complete') {
          addLog('Transcription complete!')
          setProgress(prev => ({ ...(prev ?? { status: 'complete' }), status: 'complete', percent: 100 }))
          setFiles(prev => prev.map(f => (f.id === newJobId ? { ...f, status: 'complete', srtUrl: `${API_BASE}/download/${res.data.outputFile}` } : f)))
          loadSrtContent(res.data.outputFile)
        } else if (data.type === 'error') {
          addLog(`ERROR: ${data.message}`)
        }
      }
    } catch (err) {
      const error = err as Error
      addLog(`Upload failed: ${error.message}`)
    }
  }

  const handleDrop = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file) handleFileUpload(file)
  }

  const handleFileSelect = (e: ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0]
    if (file) handleFileUpload(file)
  }

  const handleTimeInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setTimeInput(value)
    const parts = value.split(':')
    if (parts.length === 3 && videoRef.current) {
      const seconds = parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseInt(parts[2])
      if (!isNaN(seconds)) videoRef.current.currentTime = seconds
    }
  }

  const getSubtitleForTime = (timeStr: string): string => {
    const parts = timeStr.split(':')
    if (parts.length !== 3) return ''
    const seconds = parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseInt(parts[2])
    const subtitle = srtSegments.find(seg => seconds >= seg.start && seconds <= seg.end)
    return subtitle ? subtitle.text : ''
  }

  const selectFile = (file: TranscriptionFile): void => {
    setCurrentFile(file)
    if (file.status === 'complete') loadSrtContent(file.name)
  }

  const handleSrtFileSelect = async (e: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0]
    if (file && file.name.endsWith('.srt')) {
      const content = await file.text()
      setSrtEditContent(content)
      setSrtEditFilename(file.name)
    }
  }

  const handleSrtSave = async (): Promise<void> => {
    if (!srtEditContent || !srtEditFilename) return
    setSrtSaving(true)
    try {
      const formData = new FormData()
      formData.append('content', srtEditContent)
      formData.append('filename', srtEditFilename)
      await axios.post(`${API_BASE}/update-srt`, formData)
      addLog(`SRT file "${srtEditFilename}" saved successfully`)
    } catch (err) {
      console.error('Failed to save SRT:', err)
      addLog('Failed to save SRT file')
    }
    setSrtSaving(false)
  }

  const handleEditClick = (): void => {
    if (!currentSubtitle) return
    setEditingSubtitle({ ...currentSubtitle })
    setIsEditing(true)
  }

  const handleCancelEdit = (): void => {
    setIsEditing(false)
    setEditingSubtitle(null)
  }

  const handleSaveEdit = async (): Promise<void> => {
    if (!editingSubtitle || !currentFile) return
    const updatedSegments = srtSegments.map(seg =>
      seg.start === currentSubtitle?.start && seg.end === currentSubtitle?.end ? editingSubtitle : seg
    )
    const srtLines: (string | number)[] = []
    updatedSegments.forEach((seg, i) => {
      srtLines.push(i + 1)
      srtLines.push(`${formatSrtTimestamp(seg.start)} --> ${formatSrtTimestamp(seg.end)}`)
      srtLines.push(seg.text)
      srtLines.push('')
    })
    const newSrt = srtLines.join('\n')
    try {
      const formData = new FormData()
      formData.append('content', newSrt)
      formData.append('filename', currentFile.name)
      await axios.post(`${API_BASE}/update-srt`, formData)
      setSrtContent(newSrt)
      setSrtSegments(updatedSegments)
      setCurrentSubtitle(editingSubtitle)
      setIsEditing(false)
      setEditingSubtitle(null)
      addLog('Subtitle updated successfully')
    } catch (err) {
      console.error('Failed to save subtitle:', err)
      addLog('Failed to save subtitle')
    }
  }

  const completeFiles = files.filter(f => f.status === 'complete')

  const tabIcon = (id: TabType) => {
    if (id === 'transcribe') return <IconUpload className="shrink-0 opacity-90" />
    if (id === 'srt-edit') return <IconDoc className="shrink-0 opacity-90" />
    return <IconFolder className="shrink-0 opacity-90" />
  }

  return (
    <div className="civic-shell-bg flex min-h-screen flex-col lg:flex-row">
      {/* Primary navigation — civic rail aligned with Sabah Civic Platform sidebar language */}
      <aside className="flex shrink-0 flex-col border-slate-200/80 bg-slate-950 text-slate-300 shadow-[0_24px_60px_rgba(2,6,23,0.35)] lg:w-[17rem] lg:border-r lg:shadow-none">
        <div className="relative hidden overflow-hidden border-b border-white/10 px-5 py-6 lg:block">
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(29,78,216,0.12),transparent_45%,rgba(2,6,23,0.4)_100%)]" />
          <div className="relative flex items-start gap-3">
            <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-blue-700 shadow-[0_10px_30px_rgba(29,78,216,0.35)]">
              <IconDoc className="h-5 w-5 text-white" />
            </span>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/80">Court services</p>
              <h1 className="mt-1.5 text-lg font-semibold leading-snug tracking-tight text-white">Transcription workspace</h1>
              <p className="mt-2 text-xs leading-relaxed text-slate-400">Official record preparation. Same processing pipeline as before.</p>
            </div>
          </div>
        </div>
        <div className="flex gap-1 overflow-x-auto border-b border-white/10 px-2 py-2 lg:flex-col lg:border-b-0 lg:space-y-1.5 lg:px-4 lg:py-5">
          {tabConfig.map(tab => {
            const active = activeTab === tab.id
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`flex min-w-[140px] shrink-0 items-start gap-3 rounded-xl px-3.5 py-3 text-left transition-all duration-200 lg:min-w-0 lg:w-full ${
                  active
                    ? 'bg-blue-600/18 text-white ring-1 ring-inset ring-blue-400/35'
                    : 'text-slate-300 hover:bg-white/5 hover:text-white'
                }`}
              >
                <span className={`mt-0.5 shrink-0 ${active ? 'text-blue-300' : 'text-slate-500'}`}>{tabIcon(tab.id)}</span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium leading-tight">{tab.label}</span>
                  <span className="mt-0.5 hidden text-[11px] text-slate-500 lg:block">{tab.hint}</span>
                  {tab.id === 'files' && (
                    <span className="mt-1 inline-block rounded-full bg-blue-600/25 px-1.5 py-0.5 text-[10px] font-semibold text-blue-100">
                      {files.length} items
                    </span>
                  )}
                </span>
              </button>
            )
          })}
        </div>
        <div className="mt-auto hidden border-t border-white/10 bg-[linear-gradient(180deg,rgba(2,6,23,0.5),rgba(2,6,23,0.92))] p-4 text-[11px] leading-relaxed text-slate-500 lg:block">
          {onLogout ? (
            <button
              type="button"
              onClick={onLogout}
              className="mb-3 w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs font-medium text-slate-200 transition hover:bg-white/10"
            >
              Logout
            </button>
          ) : null}
          {jobId ? (
            <>
              <p className="font-medium text-slate-400">Active job</p>
              <p className="mt-1 font-mono text-slate-300">{jobId}</p>
            </>
          ) : (
            <p>No active job. Upload media to begin.</p>
          )}
        </div>
      </aside>

      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div className="pointer-events-none absolute inset-x-0 top-0 z-0 h-40 bg-[radial-gradient(circle_at_top_right,_rgba(14,165,233,0.12),_transparent_38%),linear-gradient(180deg,_rgba(255,255,255,0.7),_rgba(255,255,255,0))]" />
        {/* Workspace hero — Sabah Civic `civic-hero` pattern */}
        <header className="relative z-10 border-b border-slate-200/80 px-4 py-4 sm:px-6 lg:px-8 lg:pt-8">
          <div className="civic-hero px-5 py-5 sm:px-8 sm:py-6">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-blue-700">Court transcription workspace</p>
                <h2 className="mt-3 truncate text-3xl font-semibold tracking-tight text-slate-950">
                  {currentFile ? currentFile.originalName : 'No media loaded'}
                </h2>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600 sm:text-base">
                  Upload recordings, monitor pipeline status, and refine transcript output without changing core workflow behavior.
                </p>
              </div>
              {currentFile && (
                <div className="flex flex-wrap gap-2 text-xs text-slate-500">
                  <span className="max-w-full truncate rounded-full bg-blue-50 px-3 py-1.5 font-mono text-blue-900/90">Output: {currentFile.name}</span>
                  <span
                    className={`rounded-full px-3 py-1.5 font-semibold capitalize ${
                      currentFile.status === 'complete' ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-900'
                    }`}
                  >
                    {currentFile.status}
                  </span>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Main stage + inspector */}
        <div className="relative z-10 flex min-h-0 flex-1 flex-col xl:flex-row">
          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
            {/* Video first in flow; overlays unchanged */}
            <div className="mx-auto max-w-5xl">
              <div className="mb-2 flex items-end justify-between gap-3">
                <div>
                  <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Hearing recording</h2>
                  <p className="text-sm text-slate-600">Playback and on-screen transcript alignment</p>
                </div>
                {srtSegments.length > 0 && (
                  <div className="hidden text-right sm:block">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Jump to time</p>
                    <input
                      type="text"
                      value={timeInput}
                      onChange={handleTimeInputChange}
                      placeholder="HH:MM:SS"
                      className="mt-1 h-9 w-32 rounded-xl border border-[var(--civic-border)] bg-white px-2 text-center font-mono text-sm text-slate-800 shadow-sm outline-none ring-blue-600/30 focus:ring-2"
                    />
                  </div>
                )}
              </div>

              {currentFile ? (
                <div className="relative overflow-hidden rounded-[1.125rem] border border-[var(--civic-border)] bg-black shadow-[0_10px_34px_rgba(15,23,42,0.08)]">
                  <div className="absolute left-3 top-3 z-10 max-w-[min(100%,20rem)] truncate rounded-full bg-black/70 px-2 py-1 text-xs text-white">
                    {currentFile.originalName}
                  </div>
                  {srtSegments.length > 0 && (
                    <div className="absolute right-3 top-3 z-10 flex max-w-[min(100%,18rem)] flex-col gap-2 sm:hidden">
                      <input
                        type="text"
                        value={timeInput}
                        onChange={handleTimeInputChange}
                        placeholder="HH:MM:SS"
                        className="h-9 rounded-xl border border-white/20 bg-black/70 px-2 text-center font-mono text-xs text-white outline-none ring-blue-400/50 focus:ring-2"
                      />
                      <div className="truncate rounded-xl border border-white/10 bg-black/75 px-2 py-1.5 text-[11px] text-slate-200">
                        {getSubtitleForTime(timeInput) || 'No subtitle at this time'}
                      </div>
                    </div>
                  )}
                  <div className="aspect-video">
                    <video
                      ref={videoRef}
                      controls
                      crossOrigin="anonymous"
                      src={currentFile.jobId ? `${API_BASE}/stream/${currentFile.jobId}/original.mp4` : `${API_BASE}/stream/${currentFile.originalName}`}
                      onTimeUpdate={handleTimeUpdate}
                      className="h-full w-full object-contain"
                    />
                  </div>
                </div>
              ) : (
                <Card className="flex flex-col items-center justify-center gap-4 border-dashed py-16 text-center">
                  <IconFilm className="h-12 w-12 text-slate-400" />
                  <div>
                    <p className="text-sm font-semibold text-slate-800">No recording in the viewer</p>
                    <p className="mt-1 max-w-sm text-xs text-slate-500">Upload a file from New transcription, or pick a completed item in Library.</p>
                  </div>
                </Card>
              )}

              {/* Subtitle block below player — was separate card in left column */}
              {srtSegments.length > 0 && currentFile && (
                <Card className="mt-5 p-4 sm:p-5">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Line at playhead</h3>
                      <p className="mt-1 font-mono text-xs text-slate-500">
                        {currentSubtitle
                          ? `${formatTimestamp(currentSubtitle.start)} → ${formatTimestamp(currentSubtitle.end)}`
                          : '—'}
                      </p>
                    </div>
                    {currentSubtitle && !isEditing && (
                      <Button variant="outline" size="sm" type="button" className="h-9 shrink-0 self-start text-xs" onClick={handleEditClick}>
                        Edit line
                      </Button>
                    )}
                  </div>
                  <div className="mt-4">
                    {isEditing && editingSubtitle ? (
                      <div className="space-y-3 border-t border-slate-200/80 pt-4">
                        <textarea
                          value={editingSubtitle.text}
                          onChange={e => setEditingSubtitle({ ...editingSubtitle, text: e.target.value })}
                          rows={4}
                          className="w-full rounded-xl border border-[var(--civic-border)] bg-[var(--civic-surface-soft)] px-3 py-2 text-sm text-slate-800 outline-none ring-blue-600/30 focus:ring-2"
                        />
                        <div className="flex flex-wrap justify-end gap-2">
                          <Button variant="primary" size="sm" type="button" className="h-9 text-xs" onClick={handleSaveEdit}>
                            Save
                          </Button>
                          <Button variant="outline" size="sm" type="button" className="h-9 text-xs" onClick={handleCancelEdit}>
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <p className="min-h-[4.5rem] text-base leading-relaxed text-slate-800">{currentSubtitle ? currentSubtitle.text : '…'}</p>
                    )}
                  </div>
                  {srtSegments.length > 0 && (
                    <div className="mt-4 hidden border-t border-slate-200/80 pt-3 sm:block">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Preview at typed time</p>
                      <p className="mt-1 text-sm text-slate-600">{getSubtitleForTime(timeInput) || 'No subtitle at this time'}</p>
                    </div>
                  )}
                </Card>
              )}

              {/* Progress under media — was below video in left stack as its own card */}
              {jobId && (
                <Card className="mt-5 grid gap-4 p-4 lg:grid-cols-[1fr_minmax(0,14rem)]">
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Job progress</h3>
                      <span className="font-mono text-xs text-slate-600">{progress?.percent ?? 0}%</span>
                    </div>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200/90">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-blue-700 to-sky-500 transition-all duration-300"
                        style={{ width: `${progress?.percent || 0}%` }}
                      />
                    </div>
                    <dl className="mt-4 grid grid-cols-3 gap-3 text-center">
                      <div className="rounded-xl border border-slate-200 bg-slate-50 py-2">
                        <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Chunks</dt>
                        <dd className="text-lg font-semibold text-slate-900">{progress?.totalChunks ?? 0}</dd>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-slate-50 py-2">
                        <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Done</dt>
                        <dd className="text-lg font-semibold text-slate-900">{progress?.completed ?? 0}</dd>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-slate-50 py-2">
                        <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Span</dt>
                        <dd className="truncate px-1 text-xs font-semibold text-slate-900">{progress?.currentChunk || '—'}</dd>
                      </div>
                    </dl>
                  </div>
                  <div className="flex min-h-[8rem] flex-col rounded-xl border border-slate-200 bg-slate-950">
                    <p className="border-b border-slate-800 px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Activity</p>
                    <div className="min-h-0 flex-1 overflow-y-auto p-2 font-mono text-[10px] leading-relaxed text-slate-300">
                      {logs.map((log, i) => (
                        <div key={i} className="flex gap-1.5">
                          <span className="shrink-0 text-slate-500">{log.time}</span>
                          <span className="min-w-0 break-words">{log.message}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </Card>
              )}
            </div>
          </div>

          {/* Inspector — tab tools; was entire right column of cards */}
          <aside className="flex w-full shrink-0 flex-col border-t border-slate-200/80 bg-white/95 backdrop-blur-sm xl:w-[min(100%,26rem)] xl:border-l xl:border-t-0">
            <div className="border-b border-[var(--civic-border)] bg-[color-mix(in_srgb,var(--civic-surface)_97%,transparent)] px-4 py-3 shadow-[0_8px_22px_rgba(15,23,42,0.04)]">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Panel</p>
              <p className="text-sm font-semibold text-slate-900">
                {activeTab === 'transcribe' && 'Ingest & queue'}
                {activeTab === 'srt-edit' && 'Transcript file'}
                {activeTab === 'files' && 'Matter library'}
              </p>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-4 pb-8">
              {activeTab === 'transcribe' && (
                <div className="space-y-4">
                  <input ref={mediaInputRef} type="file" accept="video/*,audio/*" onChange={handleFileSelect} className="hidden" />
                  <div
                    className="group flex cursor-pointer flex-col gap-4 rounded-[1.125rem] border-2 border-dashed border-slate-200 bg-white p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-md sm:flex-row sm:items-center"
                    onDragOver={e => e.preventDefault()}
                    onDrop={handleDrop}
                    onClick={() => mediaInputRef.current?.click()}
                  >
                    <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-blue-50 text-blue-700 transition-colors group-hover:bg-blue-700 group-hover:text-white">
                      <IconUpload className="h-7 w-7" />
                    </div>
                    <div className="min-w-0 flex-1 text-left">
                      <p className="text-sm font-semibold text-slate-900">Drop files here or click to browse</p>
                      <p className="mt-1 text-xs text-slate-600">MP4, MKV, AVI, MP3, WAV, and other common formats.</p>
                    </div>
                    <Button variant="primary" size="sm" type="button" className="h-9 shrink-0 text-xs" onClick={e => (e.stopPropagation(), mediaInputRef.current?.click())}>
                      Browse
                    </Button>
                  </div>
                  <p className="text-xs leading-relaxed text-slate-500">
                    Files are transcribed on the server. Progress and logs appear in the workspace below the player once a job starts.
                  </p>
                </div>
              )}

              {activeTab === 'srt-edit' && (
                <div className="flex h-full min-h-[20rem] flex-col gap-4">
                  <input ref={srtInputRef} type="file" accept=".srt" onChange={handleSrtFileSelect} className="hidden" />
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="primary" size="sm" className="h-9 text-xs" onClick={() => srtInputRef.current?.click()}>
                      Open .srt
                    </Button>
                    {srtEditContent && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-9 text-xs"
                        onClick={() => {
                          setSrtEditContent('')
                          setSrtEditFilename('')
                        }}
                      >
                        Clear
                      </Button>
                    )}
                  </div>

                  {completeFiles.length > 0 && !srtEditContent && (
                    <div>
                      <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Load from library</p>
                      <div className="civic-soft-block flex max-h-40 flex-col gap-1 overflow-y-auto p-2">
                        {completeFiles.map(file => (
                          <button
                            key={file.name}
                            type="button"
                            className="truncate rounded-xl px-2 py-1.5 text-left text-xs text-slate-800 hover:bg-white"
                            onClick={async () => {
                              try {
                                const res = await axios.get<string>(`${API_BASE}/download/${file.name}`)
                                setSrtEditContent(res.data)
                                setSrtEditFilename(file.name)
                              } catch (err) {
                                console.error('Failed to load SRT:', err)
                              }
                            }}
                          >
                            {file.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {srtEditContent ? (
                    <div className="flex min-h-0 flex-1 flex-col gap-3">
                      <p className="truncate rounded-xl border border-slate-200 bg-slate-50 px-2 py-1.5 font-mono text-xs text-slate-700">{srtEditFilename}</p>
                      <textarea
                        value={srtEditContent}
                        onChange={e => setSrtEditContent(e.target.value)}
                        className="min-h-[12rem] w-full flex-1 resize-y rounded-xl border border-[var(--civic-border)] bg-white p-3 font-mono text-xs leading-relaxed text-slate-800 outline-none ring-blue-600/30 focus:ring-2"
                        placeholder="SRT content…"
                      />
                      <Button variant="primary" type="button" onClick={handleSrtSave} disabled={srtSaving}>
                        {srtSaving ? 'Saving…' : 'Save SRT'}
                      </Button>
                    </div>
                  ) : (
                    <p className="text-xs text-slate-500">Open an SRT or pick a completed transcript from the list above.</p>
                  )}
                </div>
              )}

              {activeTab === 'files' && (
                <div className="space-y-3">
                  {files.length > 0 ? (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Source</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="w-14 text-right">SRT</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {files.map(file => {
                          const active = currentFile?.id === file.id
                          return (
                            <TableRow
                              key={file.id ?? file.name}
                              className={`cursor-pointer ${active ? 'bg-blue-50/80' : ''}`}
                              onClick={() => selectFile(file)}
                            >
                              <TableCell>
                                <span className="block font-medium text-slate-900">{file.originalName}</span>
                                <span className="mt-0.5 block truncate font-mono text-[11px] text-slate-500">{file.name}</span>
                              </TableCell>
                              <TableCell>
                                <span
                                  className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                                    file.status === 'complete' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                                  }`}
                                >
                                  {file.status}
                                </span>
                              </TableCell>
                              <TableCell className="text-right">
                                {file.status === 'complete' ? (
                                  <a
                                    href={`${API_BASE}/download/${file.name}`}
                                    className="text-sm font-medium text-blue-700 underline-offset-2 hover:text-blue-800 hover:underline"
                                    onClick={e => e.stopPropagation()}
                                  >
                                    Get
                                  </a>
                                ) : (
                                  <span className="text-slate-400">—</span>
                                )}
                              </TableCell>
                            </TableRow>
                          )
                        })}
                      </TableBody>
                    </Table>
                  ) : (
                    <div className="civic-soft-block border-dashed py-12 text-center">
                      <p className="text-sm font-medium text-slate-700">No files yet</p>
                      <p className="mt-1 text-xs text-slate-500">Completed jobs will appear in this table.</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </aside>
        </div>
      </div>
    </div>
  )
}

export default App
