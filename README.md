# Court Transcription System

A professional court transcription system that converts video/audio to subtitles using Qwen3-ASR model via vLLM API.

## Features

- **Professional UI** - Court-friendly interface with video player and subtitle support
- **Real-time Progress** - Live transcription status with chunk processing
- **Parallel Processing** - 20-thread audio splitting, 30-thread transcription
- **Video Playback** - Watch video with auto-generated subtitles
- **Custom Subtitle Display** - Shows current subtitle synced with video player
- **Editable Subtitles** - Edit and save subtitle changes directly in the browser
- **Time Seek** - Input field to jump to any timestamp with preview
- **SRT Export** - Download transcription as .srt subtitle files

## Requirements

- Node.js 18+
- Python 3.10+
- ffmpeg
- vLLM server with Qwen3-ASR-1.7B model running at `192.168.50.173:9999`

## Quick Start

```bash
# Install dependencies
npm install

# Start both backend and frontend
npm run dev

# Or restart both services
npm run restart
```

Then open **http://localhost:28361** in your browser.

## Project Structure

```
.
├── server.ts           # Express backend API
├── package.json        # Node dependencies
├── vite.config.js      # Vite configuration
├── index.html          # Entry HTML
├── src/
│   ├── main.jsx        # React entry point
│   ├── App.jsx         # Main React component
│   └── index.css       # Styles
├── outputs/            # Generated SRT files
└── uploads/            # Temporary upload files
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/transcribe` | Upload and transcribe file |
| POST | `/api/update-srt` | Update SRT file (body: content, filename) |
| GET | `/api/progress/:jobId` | SSE for real-time progress |
| GET | `/api/files` | List all transcription files |
| GET | `/api/download/*` | Download SRT file |
| GET | `/api/stream/*` | Stream video file |
| GET | `/api/srt/*` | Get SRT content for subtitles |

## Configuration

Configure via environment variables or `.env` file:

```bash
# Create .env file
VLLM_API_URL=http://192.168.50.173:9999
VLLM_API_KEY=api-key
VLLM_MODEL=qwen3-asr-1.7b
PORT=28360
```

Or edit `server.ts` directly:

```javascript
const VLLM_API_URL = 'http://192.168.50.173:9999';  // vLLM API
const VLLM_MODEL = 'qwen3-asr-1.7b';                // Model name
const CHUNK_DURATION = 15;                          // Seconds per chunk
const MAX_WORKERS = 30;                             // Transcription threads
const CHUNK_WORKERS = 20;                           // FFmpeg threads
const PORT = 28360;                                 // Server port
```

## Usage

1. Open http://localhost:28361
2. Click or drag & drop a video/audio file
3. Wait for transcription to complete (progress shown in real-time)
4. Watch video with subtitles synced below the player
5. Use time input (top-right) to seek to any timestamp
6. Click "Edit" to modify subtitle text, then "Save" to persist changes
7. Download .srt file

## Python Version (Legacy)

The original Python script is still available:

```bash
# 15-second chunks, 10 parallel workers
python3 transcribe.py video.mp4

# Custom settings
python3 transcribe.py video.mp4 -c 20 -w 5
```

## Output Format

Generates `.srt` (SubRip Subtitle) files:

```
1
00:00:00,000 --> 00:00:15,000
Court transcription text here...

2
00:00:15,000 --> 00:00:30,000
More transcribed text...
```