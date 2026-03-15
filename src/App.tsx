import { useState, useRef, useEffect, useCallback, ChangeEvent, DragEvent, FormEvent } from 'react'
import axios from 'axios'

const API_BASE = '/api'

// Types
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

// Parse SRT content into segments array
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
        const text = lines.slice(2).join('\n')
        segments.push({ start, end, text })
      }
    }
  }
  return segments
}

// Format timestamp for display
function formatTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

// Format SRT timestamp (HH:MM:SS,mmm)
function formatSrtTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  const ms = Math.floor((seconds % 1) * 1000)
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')},${ms.toString().padStart(3, '0')}`
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

  // Load existing files on mount
  useEffect(() => {
    fetchFiles()
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close()
      }
    }
  }, [])

  // Parse SRT when content changes
  useEffect(() => {
    const segments = parseSrt(srtContent)
    setSrtSegments(segments)
  }, [srtContent])

  // Update current subtitle based on video time
  const handleTimeUpdate = useCallback(() => {
    if (videoRef.current && srtSegments.length > 0) {
      const currentTime = videoRef.current.currentTime
      const subtitle = srtSegments.find(seg => currentTime >= seg.start && currentTime <= seg.end)
      setCurrentSubtitle(subtitle || null)
      setTimeInput(formatTimestamp(currentTime))
    }
  }, [srtSegments])

  // Handle time input change and seek
  const handleTimeInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setTimeInput(value)

    // Parse time string to seconds
    const parts = value.split(':')
    if (parts.length === 3) {
      const seconds = parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseInt(parts[2])
      if (!isNaN(seconds) && videoRef.current) {
        videoRef.current.currentTime = seconds
      }
    }
  }

  // Get subtitle for a specific time (for time input display)
  const getSubtitleForTime = (timeStr: string): string => {
    const parts = timeStr.split(':')
    if (parts.length !== 3) return ''
    const seconds = parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseInt(parts[2])
    const subtitle = srtSegments.find(seg => seconds >= seg.start && seconds <= seg.end)
    return subtitle ? subtitle.text : ''
  }

  const fetchFiles = async (): Promise<void> => {
    try {
      const res = await axios.get<{ files: TranscriptionFile[] }>(`${API_BASE}/files`)
      const fileList = res.data.files || []
      setFiles(fileList)

      // Auto-select first complete file if none selected
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
  }

  const addLog = useCallback((message: string): void => {
    const now = new Date()
    const time = now.toLocaleTimeString('en-US', { hour12: false })
    setLogs(prev => [...prev.slice(-50), { time, message }])
  }, [])

  const handleFileUpload = async (file: File): Promise<void> => {
    const formData = new FormData()
    formData.append('file', file)

    addLog(`Uploading ${file.name}...`)

    try {
      const res = await axios.post<{ jobId: string; outputFile: string }>(`${API_BASE}/transcribe`, formData)
      const newJobId = res.data.jobId
      setJobId(newJobId)

      const newFile: TranscriptionFile = {
        id: newJobId,
        name: res.data.outputFile,
        originalName: file.name,
        status: 'processing'
      }
      setFiles(prev => [newFile, ...prev])
      setCurrentFile(newFile)

      addLog(`Job started: ${newJobId}`)

      // Connect to SSE
      if (eventSourceRef.current) {
        eventSourceRef.current.close()
      }

      eventSourceRef.current = new EventSource(`${API_BASE}/progress/${newJobId}`)
      eventSourceRef.current.onmessage = (e: MessageEvent) => {
        const data = JSON.parse(e.data)

        if (data.type === 'status') {
          addLog(data.message)
          setProgress(prev => ({ ...prev, status: data.message }))
        } else if (data.type === 'chunks-created') {
          setProgress(prev => ({ ...prev, totalChunks: data.count }))
        } else if (data.type === 'chunk-complete') {
          const percent = Math.round((data.chunkIndex / data.totalChunks) * 100)
          setProgress(prev => ({
            ...prev,
            completed: data.chunkIndex,
            percent,
            currentChunk: `${data.start}s - ${data.end}s`
          }))
        } else if (data.type === 'complete') {
          addLog('Transcription complete!')
          setProgress(prev => ({ ...prev, status: 'complete', percent: 100 }))

          // Update file status
          setFiles(prev => prev.map(f =>
            f.id === newJobId ? { ...f, status: 'complete', srtUrl: `${API_BASE}/download/${res.data.outputFile}` } : f
          ))

          // Load SRT for subtitle
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

  const loadSrtContent = async (filename: string): Promise<void> => {
    try {
      const res = await axios.get<string>(`${API_BASE}/download/${filename}`)
      setSrtContent(res.data)
      setSrtSegments(parseSrt(res.data))
    } catch (err) {
      console.error('Failed to load SRT:', err)
    }
  }

  // Handle subtitle edit
  const handleEditClick = (): void => {
    if (currentSubtitle) {
      setEditingSubtitle({ ...currentSubtitle })
      setIsEditing(true)
    }
  }

  const handleSaveEdit = async (): Promise<void> => {
    if (!editingSubtitle || !currentFile) return

    // Update the segment in our local state
    const updatedSegments = srtSegments.map(seg =>
      seg.start === currentSubtitle?.start && seg.end === currentSubtitle?.end
        ? editingSubtitle
        : seg
    )

    // Reconstruct SRT content
    const srtLines: (string | number)[] = []
    updatedSegments.forEach((seg, i) => {
      const startTime = formatSrtTimestamp(seg.start)
      const endTime = formatSrtTimestamp(seg.end)
      srtLines.push(i + 1)
      srtLines.push(`${startTime} --> ${endTime}`)
      srtLines.push(seg.text)
      srtLines.push('')
    })
    const newSrt = srtLines.join('\n')

    try {
      // Send updated SRT to server
      const formData = new FormData()
      formData.append('content', newSrt)
      formData.append('filename', currentFile.name)

      await axios.post(`${API_BASE}/update-srt`, formData)

      // Update local state
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

  const handleCancelEdit = (): void => {
    setIsEditing(false)
    setEditingSubtitle(null)
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

  const selectFile = (file: TranscriptionFile): void => {
    setCurrentFile(file)
    if (file.status === 'complete') {
      loadSrtContent(file.name)
    }
  }

  // Handle SRT file upload
  const handleSrtFileSelect = async (e: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0]
    if (file && file.name.endsWith('.srt')) {
      const content = await file.text()
      setSrtEditContent(content)
      setSrtEditFilename(file.name)
    }
  }

  // Save SRT content
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

  return (
    <>
      <header className="header">
        <div className="header-content">
          <div className="logo">
            <div className="logo-icon">⚖</div>
            <div>
              <h1>Court Transcription System</h1>
              <span>Automated Audio to Text with Subtitle</span>
            </div>
          </div>
        </div>
      </header>

      <main className="main">
        {/* Left Column - Video Player */}
        <div className="video-section">
          <div className="card">
            <div className="card-header">
              <span style={{ fontSize: '1.25rem' }}>🎬</span>
              <h2>Video Player with Subtitles</h2>
            </div>
            <div className="card-body">
              {currentFile ? (
                <div className="video-container">
                  <video
                    ref={videoRef}
                    controls
                    crossOrigin="anonymous"
                    src={currentFile.jobId
                      ? `${API_BASE}/stream/${currentFile.jobId}/original.mp4`
                      : `${API_BASE}/stream/${currentFile.originalName}`}
                    onTimeUpdate={handleTimeUpdate}
                  />
                  <div className="video-title">{currentFile.originalName}</div>

                  {/* Time Input */}
                  {srtSegments.length > 0 && (
                    <div className="time-input-container">
                      <input
                        type="text"
                        className="time-input"
                        value={timeInput}
                        onChange={handleTimeInputChange}
                        placeholder="HH:MM:SS"
                      />
                      <div className="time-subtitle-preview">
                        {getSubtitleForTime(timeInput) || 'No subtitle at this time'}
                      </div>
                    </div>
                  )}

                </div>
              ) : (
                <div className="empty-state">
                  <div className="empty-state-icon">🎥</div>
                  <p>Upload a file to start transcribing</p>
                </div>
              )}
            </div>
          </div>

          {/* Subtitle Display */}
          {srtSegments.length > 0 && currentFile && (
            <div className="card">
              <div className="card-header">
                <span style={{ fontSize: '1.25rem' }}>📝</span>
                <h2>Current Subtitle</h2>
              </div>
              <div className="card-body">
                <div className="subtitle-container">
                  <div className="subtitle-header">
                    <span>📝 Subtitle</span>
                    {currentSubtitle && (
                      <button
                        className="btn btn-small"
                        onClick={handleEditClick}
                      >
                        Edit
                      </button>
                    )}
                  </div>
                  {isEditing && editingSubtitle ? (
                    <div className="subtitle-edit">
                      <div className="subtitle-time">
                        {formatTimestamp(editingSubtitle.start)} - {formatTimestamp(editingSubtitle.end)}
                      </div>
                      <textarea
                        value={editingSubtitle.text}
                        onChange={(e) => setEditingSubtitle({ ...editingSubtitle, text: e.target.value })}
                        rows={3}
                        className="subtitle-textarea"
                      />
                      <div className="subtitle-edit-actions">
                        <button className="btn btn-primary btn-small" onClick={handleSaveEdit}>
                          Save
                        </button>
                        <button className="btn btn-small" onClick={handleCancelEdit}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="subtitle-text">
                      {currentSubtitle ? currentSubtitle.text : '...'}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Transcription Status */}
          {jobId && (
            <div className="card">
              <div className="card-header">
                <span style={{ fontSize: '1.25rem' }}>📝</span>
                <h2>Transcription Progress</h2>
              </div>
              <div className="card-body">
                <div className="progress-container">
                  <div className="progress-bar">
                    <div
                      className="progress-fill"
                      style={{ width: `${progress?.percent || 0}%` }}
                    />
                  </div>
                  <div className="progress-stats">
                    <div className="stat-box">
                      <div className="stat-value">{progress?.totalChunks || 0}</div>
                      <div className="stat-label">Total Chunks</div>
                    </div>
                    <div className="stat-box">
                      <div className="stat-value">{progress?.completed || 0}</div>
                      <div className="stat-label">Completed</div>
                    </div>
                    <div className="stat-box">
                      <div className="stat-value">{progress?.currentChunk || '-'}</div>
                      <div className="stat-label">Current</div>
                    </div>
                  </div>
                </div>
                <div className="status-log">
                  {logs.map((log, i) => (
                    <div key={i} className="status-log-entry">
                      <span className="status-log-time">[{log.time}]</span>
                      <span className="status-log-text">{log.message}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right Column - Upload & Files */}
        <div className="video-section">
          <div className="tabs">
            <button
              className={`tab ${activeTab === 'transcribe' ? 'active' : ''}`}
              onClick={() => setActiveTab('transcribe')}
            >
              Transcribe
            </button>
            <button
              className={`tab ${activeTab === 'srt-edit' ? 'active' : ''}`}
              onClick={() => setActiveTab('srt-edit')}
            >
              SRT Editor
            </button>
            <button
              className={`tab ${activeTab === 'files' ? 'active' : ''}`}
              onClick={() => setActiveTab('files')}
            >
              Files ({files.length})
            </button>
          </div>

          {activeTab === 'transcribe' && (
            <div className="card">
              <div className="card-header">
                <span style={{ fontSize: '1.25rem' }}>📁</span>
                <h2>Upload Audio/Video</h2>
              </div>
              <div className="card-body">
                <div
                  className="upload-zone"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={handleDrop}
                  onClick={() => document.getElementById('fileInput')?.click()}
                >
                  <input
                    type="file"
                    id="fileInput"
                    accept="video/*,audio/*"
                    onChange={handleFileSelect}
                  />
                  <div className="upload-icon">🎬</div>
                  <h3>Click or Drag & Drop</h3>
                  <p>MP4, MKV, AVI, MP3, WAV and more</p>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'srt-edit' && (
            <div className="card">
              <div className="card-header">
                <span style={{ fontSize: '1.25rem' }}>📝</span>
                <h2>SRT Editor</h2>
              </div>
              <div className="card-body">
                <div className="srt-upload-zone">
                  <input
                    type="file"
                    id="srtInput"
                    accept=".srt"
                    onChange={handleSrtFileSelect}
                  />
                  <div
                    className="srt-upload-area"
                    onClick={() => document.getElementById('srtInput')?.click()}
                  >
                    <div className="upload-icon">📄</div>
                    <h3>Click to Upload SRT</h3>
                    <p>Or select a file from Files tab to edit</p>
                  </div>
                </div>

                {srtEditContent && (
                  <div className="srt-editor">
                    <div className="srt-filename">
                      <strong>Editing:</strong> {srtEditFilename}
                    </div>
                    <textarea
                      className="srt-textarea"
                      value={srtEditContent}
                      onChange={(e) => setSrtEditContent(e.target.value)}
                      rows={20}
                      placeholder="SRT content..."
                    />
                    <div className="srt-actions">
                      <button
                        className="btn btn-primary"
                        onClick={handleSrtSave}
                        disabled={srtSaving}
                      >
                        {srtSaving ? 'Saving...' : 'Save SRT'}
                      </button>
                      <button
                        className="btn"
                        onClick={() => {
                          setSrtEditContent('')
                          setSrtEditFilename('')
                        }}
                      >
                        Clear
                      </button>
                    </div>
                  </div>
                )}

                {files.length > 0 && !srtEditContent && (
                  <div className="srt-quick-load">
                    <h4>Quick Load from Files:</h4>
                    <div className="srt-file-list">
                      {files.filter(f => f.status === 'complete').map(file => (
                        <button
                          key={file.name}
                          className="btn btn-small"
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
              </div>
            </div>
          )}

          {activeTab === 'files' && (
            <div className="card">
              <div className="card-header">
                <span style={{ fontSize: '1.25rem' }}>📂</span>
                <h2>Transcription Files</h2>
              </div>
              <div className="card-body">
                {files.length > 0 ? (
                  <div className="file-list">
                    {files.map((file) => (
                      <div
                        key={file.id}
                        className={`file-item ${currentFile?.id === file.id ? 'active' : ''}`}
                        onClick={() => selectFile(file)}
                      >
                        <div className="file-info">
                          <div className="file-icon">🎵</div>
                          <div>
                            <div className="file-name">{file.originalName}</div>
                            <div style={{ fontSize: '0.75rem', color: '#718096' }}>
                              → {file.name}
                            </div>
                          </div>
                        </div>
                        <div className="file-status">
                          <span className={`status-badge ${file.status}`}>
                            {file.status}
                          </span>
                          {file.status === 'complete' && (
                            <a
                              href={`${API_BASE}/download/${file.name}`}
                              className="btn btn-download"
                              style={{ padding: '0.4rem 0.75rem', fontSize: '0.75rem' }}
                              onClick={(e) => e.stopPropagation()}
                            >
                              ⬇
                            </a>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="empty-state">
                    <div className="empty-state-icon">📭</div>
                    <p>No transcription files yet</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </main>
    </>
  )
}

export default App