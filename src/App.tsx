import { useState, useRef, useEffect, useCallback, ChangeEvent, DragEvent } from 'react'
import axios from 'axios'

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

type TabType = 'transcribe' | 'srt-edit' | 'files'
type ButtonVariant = 'default' | 'outline'

interface SectionCardProps {
  icon: string
  title: string
  children: React.ReactNode
}

interface UiButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
}

const tabConfig: Array<{ id: TabType; label: string; icon: string }> = [
  { id: 'transcribe', label: 'Transcribe', icon: '🎬' },
  { id: 'srt-edit', label: 'SRT Editor', icon: '📝' },
  { id: 'files', label: 'Files', icon: '📂' }
]

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

function SectionCard({ icon, title, children }: SectionCardProps) {
  return (
    <section className="overflow-hidden rounded-[1.125rem] border border-slate-200 bg-white/95 shadow-sm">
      <header className="flex items-center gap-3 border-b border-slate-200/80 px-6 py-4">
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-blue-100 bg-blue-50 text-lg text-blue-700">{icon}</span>
        <h2 className="text-sm font-bold uppercase tracking-[0.16em] text-slate-900">{title}</h2>
      </header>
      <div className="p-6">{children}</div>
    </section>
  )
}

function UiButton({ variant = 'outline', className = '', ...props }: UiButtonProps) {
  const base =
    'inline-flex h-10 items-center justify-center gap-2 rounded-lg border px-4 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60'
  const variants: Record<ButtonVariant, string> = {
    default: 'border-blue-700 bg-blue-700 text-white hover:bg-blue-800',
    outline: 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:text-slate-900'
  }
  return <button className={`${base} ${variants[variant]} ${className}`.trim()} {...props} />
}

function App() {
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

  return (
    <div className="min-h-screen pb-8">
      <header className="mx-auto mt-5 w-full max-w-[1600px] px-4 sm:px-6">
        <div className="rounded-[1.375rem] border border-slate-200 bg-white/90 px-6 py-6 shadow-[0_18px_60px_rgba(148,163,184,0.16)] backdrop-blur">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-blue-700">Court Automation Suite</p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">Court Transcription System</h1>
            <span className="rounded-full border border-blue-100 bg-blue-50 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-blue-700">
              Live Processing
            </span>
          </div>
          <p className="mt-3 max-w-4xl text-sm leading-6 text-slate-600 sm:text-base">
            Upload recordings, monitor transcription jobs in real time, and edit subtitle output from one modern workflow.
          </p>
        </div>
      </header>

      <main className="mx-auto mt-6 grid w-full max-w-[1600px] gap-6 px-4 sm:px-6 xl:grid-cols-[1fr_420px]">
        <section className="space-y-6">
          <SectionCard icon="🎬" title="Video Player With Subtitles">
            {currentFile ? (
              <div className="relative overflow-hidden rounded-[1.125rem] border border-slate-200 bg-slate-950">
                <div className="absolute left-3 top-3 z-10 max-w-[70%] truncate rounded-lg bg-slate-900/85 px-3 py-1 text-xs font-medium text-slate-100">
                  {currentFile.originalName}
                </div>
                {srtSegments.length > 0 && (
                  <div className="absolute right-3 top-3 z-10 flex max-w-[260px] flex-col gap-2">
                    <input
                      type="text"
                      value={timeInput}
                      onChange={handleTimeInputChange}
                      placeholder="HH:MM:SS"
                      className="h-10 rounded-xl border border-slate-500/60 bg-slate-900/85 px-3 text-center font-mono text-sm text-white outline-none ring-blue-500/50 transition focus:ring-2"
                    />
                    <div className="truncate rounded-xl bg-slate-900/90 px-3 py-2 text-xs text-slate-200">
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
              <div className="rounded-[1.125rem] border border-dashed border-slate-300 bg-slate-50/80 px-6 py-16 text-center">
                <p className="text-5xl">🎥</p>
                <p className="mt-4 text-sm font-semibold uppercase tracking-wider text-slate-700">No media selected</p>
                <p className="mt-2 text-sm text-slate-500">Upload a file from the Transcribe tab to begin.</p>
              </div>
            )}
          </SectionCard>

          {srtSegments.length > 0 && currentFile && (
            <SectionCard icon="📝" title="Current Subtitle">
              <div className="rounded-xl border border-slate-200/80 bg-slate-50/70 p-5">
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-600">Live subtitle segment</p>
                  {currentSubtitle && (
                    <UiButton variant="outline" className="h-9 px-3 text-xs" onClick={handleEditClick}>
                      Edit
                    </UiButton>
                  )}
                </div>
                {isEditing && editingSubtitle ? (
                  <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
                    <p className="font-mono text-xs text-slate-500">
                      {formatTimestamp(editingSubtitle.start)} - {formatTimestamp(editingSubtitle.end)}
                    </p>
                    <textarea
                      value={editingSubtitle.text}
                      onChange={e => setEditingSubtitle({ ...editingSubtitle, text: e.target.value })}
                      rows={4}
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none ring-blue-500/50 transition focus:ring-2"
                    />
                    <div className="flex justify-end gap-2">
                      <UiButton variant="default" className="h-9 px-3 text-xs" onClick={handleSaveEdit}>
                        Save
                      </UiButton>
                      <UiButton variant="outline" className="h-9 px-3 text-xs" onClick={handleCancelEdit}>
                        Cancel
                      </UiButton>
                    </div>
                  </div>
                ) : (
                  <div className="min-h-24 rounded-xl border border-slate-200 bg-white p-4 text-base leading-7 text-slate-800">
                    {currentSubtitle ? currentSubtitle.text : '...'}
                  </div>
                )}
              </div>
            </SectionCard>
          )}

          {jobId && (
            <SectionCard icon="📈" title="Transcription Progress">
              <div className="space-y-4">
                <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full bg-blue-700 transition-all duration-300" style={{ width: `${progress?.percent || 0}%` }} />
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                    <p className="text-xl font-bold text-slate-900">{progress?.totalChunks || 0}</p>
                    <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Total Chunks</p>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                    <p className="text-xl font-bold text-slate-900">{progress?.completed || 0}</p>
                    <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Completed</p>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                    <p className="truncate text-sm font-bold text-slate-900">{progress?.currentChunk || '-'}</p>
                    <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Current</p>
                  </div>
                </div>
                <div className="max-h-56 overflow-y-auto rounded-xl border border-slate-200 bg-slate-950 p-3 font-mono text-xs text-slate-300">
                  {logs.map((log, i) => (
                    <div key={i} className="flex gap-2 py-0.5">
                      <span className="text-slate-500">[{log.time}]</span>
                      <span>{log.message}</span>
                    </div>
                  ))}
                </div>
              </div>
            </SectionCard>
          )}
        </section>

        <section className="space-y-4">
          <div className="rounded-[1.125rem] border border-slate-200 bg-white/95 p-1 shadow-sm">
            <div className="grid grid-cols-3 gap-1">
              {tabConfig.map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`inline-flex h-11 items-center justify-center gap-2 rounded-xl text-sm font-semibold transition ${
                    activeTab === tab.id
                      ? 'border border-slate-200 bg-white text-slate-900 shadow-sm'
                      : 'border border-transparent text-slate-600 hover:border-slate-200 hover:bg-slate-50 hover:text-slate-900'
                  }`}
                >
                  <span>{tab.icon}</span>
                  <span>{tab.id === 'files' ? `Files (${files.length})` : tab.label}</span>
                </button>
              ))}
            </div>
          </div>

          {activeTab === 'transcribe' && (
            <SectionCard icon="📁" title="Upload Audio Or Video">
              <input ref={mediaInputRef} type="file" accept="video/*,audio/*" onChange={handleFileSelect} className="hidden" />
              <div
                className="cursor-pointer rounded-[1.125rem] border border-dashed border-slate-300 bg-slate-50/80 p-10 text-center transition hover:border-blue-600 hover:bg-blue-50/60"
                onDragOver={e => e.preventDefault()}
                onDrop={handleDrop}
                onClick={() => mediaInputRef.current?.click()}
              >
                <div className="mx-auto mb-4 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-blue-100 text-xl text-blue-700">🎬</div>
                <h3 className="text-base font-semibold text-slate-900">Click or drag and drop media files</h3>
                <p className="mt-1 text-sm text-slate-500">MP4, MKV, AVI, MP3, WAV and other common formats</p>
              </div>
            </SectionCard>
          )}

          {activeTab === 'srt-edit' && (
            <SectionCard icon="📝" title="SRT Editor">
              <div className="space-y-4">
                <input ref={srtInputRef} type="file" accept=".srt" onChange={handleSrtFileSelect} className="hidden" />
                <div
                  className="cursor-pointer rounded-[1.125rem] border border-dashed border-slate-300 bg-slate-50/80 p-6 text-center transition hover:border-blue-600 hover:bg-blue-50/60"
                  onClick={() => srtInputRef.current?.click()}
                >
                  <div className="mx-auto mb-3 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100 text-blue-700">📄</div>
                  <h3 className="text-sm font-semibold text-slate-900">Click to upload an SRT file</h3>
                  <p className="mt-1 text-xs text-slate-500">Or load a completed transcript from this project</p>
                </div>

                {srtEditContent && (
                  <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
                    <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                      <span className="font-semibold">Editing:</span> {srtEditFilename}
                    </div>
                    <textarea
                      value={srtEditContent}
                      onChange={e => setSrtEditContent(e.target.value)}
                      rows={20}
                      className="w-full rounded-xl border border-slate-200 bg-white p-3 font-mono text-sm text-slate-700 outline-none ring-blue-500/50 transition focus:ring-2"
                      placeholder="SRT content..."
                    />
                    <div className="flex flex-wrap gap-2">
                      <UiButton variant="default" onClick={handleSrtSave} disabled={srtSaving}>
                        {srtSaving ? 'Saving...' : 'Save SRT'}
                      </UiButton>
                      <UiButton
                        variant="outline"
                        onClick={() => {
                          setSrtEditContent('')
                          setSrtEditFilename('')
                        }}
                      >
                        Clear
                      </UiButton>
                    </div>
                  </div>
                )}

                {completeFiles.length > 0 && !srtEditContent && (
                  <div className="rounded-xl border border-slate-200/80 bg-slate-50/70 p-4">
                    <p className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-slate-600">Quick load from completed files</p>
                    <div className="flex flex-wrap gap-2">
                      {completeFiles.map(file => (
                        <UiButton
                          key={file.name}
                          variant="outline"
                          className="h-9 px-3 text-xs"
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
                        </UiButton>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </SectionCard>
          )}

          {activeTab === 'files' && (
            <SectionCard icon="🗂" title="Transcription Files">
              {files.length > 0 ? (
                <div className="space-y-2">
                  {files.map(file => {
                    const active = currentFile?.id === file.id
                    return (
                      <div
                        key={file.id ?? file.name}
                        onClick={() => selectFile(file)}
                        className={`cursor-pointer rounded-xl border p-4 transition ${
                          active ? 'border-blue-200 bg-blue-50/70 shadow-sm' : 'border-slate-200 bg-white hover:bg-slate-50'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-slate-900">{file.originalName}</p>
                            <p className="mt-1 truncate text-xs text-slate-500">→ {file.name}</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <span
                              className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider ${
                                file.status === 'complete' ? 'border border-emerald-200 bg-emerald-100 text-emerald-700' : 'border border-amber-200 bg-amber-100 text-amber-700'
                              }`}
                            >
                              {file.status}
                            </span>
                            {file.status === 'complete' && (
                              <a
                                href={`${API_BASE}/download/${file.name}`}
                                onClick={e => e.stopPropagation()}
                                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50"
                              >
                                ⬇
                              </a>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="rounded-[1.125rem] border border-dashed border-slate-300 bg-slate-50/80 px-6 py-14 text-center">
                  <p className="text-5xl">📭</p>
                  <p className="mt-4 text-sm font-semibold uppercase tracking-wider text-slate-700">No files yet</p>
                  <p className="mt-2 text-sm text-slate-500">Processed transcriptions will appear here.</p>
                </div>
              )}
            </SectionCard>
          )}
        </section>
      </main>
    </div>
  )
}

export default App
