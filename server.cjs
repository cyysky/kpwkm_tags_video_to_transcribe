require('dotenv').config();
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const axios = require('axios');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');

const execAsync = promisify(exec);

const app = express();
const upload = multer({ dest: 'uploads/' });

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configuration from environment variables
const VLLM_API_URL = process.env.VLLM_API_URL || 'http://localhost:9999';
const VLLM_API_KEY = process.env.VLLM_API_KEY || 'api-key';
const VLLM_MODEL = process.env.VLLM_MODEL || 'qwen3-asr-1.7b';
const VLLM_API_BASE = `${VLLM_API_URL}/v1`;

const CHUNK_DURATION = 15;
const MAX_WORKERS = 30;
const CHUNK_WORKERS = 20;

// Store transcription jobs
const jobs = new Map();

// SSE clients
const clients = new Map();

function formatSrtTimestamp(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const millis = Math.floor((seconds % 1) * 1000);
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')},${millis.toString().padStart(3, '0')}`;
}

function formatSrt(segments) {
    if (!segments || segments.length === 0) return '';

    const srtLines = [];
    segments.forEach((seg, i) => {
        const start = seg.start || 0;
        const end = seg.end || start + 2;
        const text = (seg.text || '').trim();

        srtLines.push(i + 1);
        srtLines.push(`${formatSrtTimestamp(start)} --> ${formatSrtTimestamp(end)}`);
        srtLines.push(text);
        srtLines.push('');
    });

    return srtLines.join('\n');
}

async function getAudioDuration(mp3File) {
    const cmd = [
        'ffprobe', '-v', 'error',
        '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1',
        mp3File
    ];
    const { stdout } = await execAsync(cmd.join(' '));
    return parseFloat(stdout.trim());
}

function broadcastProgress(jobId, data) {
    const client = clients.get(jobId);
    if (client) {
        client.write(`data: ${JSON.stringify(data)}\n\n`);
    }
}

async function splitAudioChunk(args) {
    const { mp3File, outputDir, start, end } = args;
    const chunkFile = path.join(outputDir, `chunk_${start.toString().padStart(6, '0')}_${end.toString().padStart(6, '0')}.mp3`);

    const cmd = [
        'ffmpeg', '-i', mp3File,
        '-ss', start.toString(),
        '-t', (end - start).toString(),
        '-vn',
        '-acodec', 'libmp3lame',
        '-q:a', '2',
        '-y',
        chunkFile
    ];

    await execAsync(cmd.join(' '));
    return { file: chunkFile, start, end };
}

async function splitAudioToChunks(mp3File, outputDir, jobId) {
    const duration = await getAudioDuration(mp3File);
    const chunkArgs = [];

    for (let start = 0; start < Math.ceil(duration); start += CHUNK_DURATION) {
        const end = Math.min(start + CHUNK_DURATION, Math.ceil(duration));
        chunkArgs.push({ mp3File, outputDir, start, end });
    }

    broadcastProgress(jobId, { type: 'status', message: `Splitting into ${chunkArgs.length} chunks...` });

    const chunks = [];
    for (let i = 0; i < chunkArgs.length; i += CHUNK_WORKERS) {
        const batch = chunkArgs.slice(i, i + CHUNK_WORKERS);
        const results = await Promise.all(batch.map(args => splitAudioChunk(args)));
        chunks.push(...results);
        broadcastProgress(jobId, { type: 'status', message: `Split chunk ${Math.min(i + CHUNK_WORKERS, chunkArgs.length)}/${chunkArgs.length}` });
    }

    chunks.sort((a, b) => a.start - b.start);
    broadcastProgress(jobId, { type: 'chunks-created', count: chunks.length });
    return chunks;
}

async function transcribeChunk(chunk, jobId, chunkIndex, totalChunks) {
    const { file, start, end } = chunk;

    const audioData = fs.readFileSync(file);
    const FormData = require('form-data');
    const formData = new FormData();
    formData.append('file', audioData, { filename: 'audio.mp3', contentType: 'audio/mpeg' });
    formData.append('model', VLLM_MODEL);
    formData.append('response_format', 'json');

    let segments = null;
    let plainText = '';

    try {
        const response = await axios.post(`${VLLM_API_BASE}/audio/transcriptions`, formData, {
            headers: {
                ...formData.getHeaders(),
                'Authorization': `Bearer ${VLLM_API_KEY}`
            },
            timeout: 600000
        });

        const result = response.data;
        if (result && typeof result === 'object') {
            segments = result.segments;
            plainText = result.text || '';
        }
    } catch (e) {
        console.error(`Chunk ${chunkIndex + 1} failed:`, e.message);
    }

    const adjustedSegments = [];
    if (segments && segments.length > 0) {
        segments.forEach(seg => {
            const text = (seg.text || '').trim();
            if (text) {
                adjustedSegments.push({
                    start: (seg.start || 0) + start,
                    end: (seg.end || 0) + start,
                    text: text
                });
            }
        });
    } else if (plainText) {
        adjustedSegments.push({
            start: start,
            end: end,
            text: plainText.trim()
        });
    }

    broadcastProgress(jobId, {
        type: 'chunk-complete',
        chunkIndex: chunkIndex + 1,
        totalChunks,
        start: start.toFixed(1),
        end: end.toFixed(1)
    });

    return adjustedSegments;
}

async function processTranscription(jobId, inputFile, outputFile, originalName) {
    const tempDir = path.join('uploads', jobId);
    const mp3File = path.join(tempDir, 'audio.mp3');

    try {
        fs.mkdirSync(tempDir, { recursive: true });

        // Copy original video file to job directory for streaming
        const originalExt = path.extname(originalName);
        const videoFileInJob = path.join(tempDir, 'original' + originalExt);
        fs.copyFileSync(inputFile, videoFileInJob);

        broadcastProgress(jobId, { type: 'status', message: 'Extracting audio...' });

        const convertCmd = [
            'ffmpeg', '-i', inputFile,
            '-vn',
            '-acodec', 'libmp3lame',
            '-q:a', '2',
            '-y',
            mp3File
        ];
        await execAsync(convertCmd.join(' '));

        broadcastProgress(jobId, { type: 'status', message: 'Splitting into chunks...' });
        const chunks = await splitAudioToChunks(mp3File, tempDir, jobId);

        broadcastProgress(jobId, { type: 'status', message: 'Transcribing chunks...' });

        const allSegments = [];

        for (let i = 0; i < chunks.length; i += MAX_WORKERS) {
            const batch = chunks.slice(i, i + MAX_WORKERS);
            const batchPromises = batch.map((chunk, idx) =>
                transcribeChunk(chunk, jobId, i + idx, chunks.length)
            );
            const results = await Promise.all(batchPromises);
            results.forEach(seg => allSegments.push(...seg));
        }

        allSegments.sort((a, b) => a.start - b.start);

        const srtContent = formatSrt(allSegments);
        fs.writeFileSync(outputFile, srtContent, 'utf8');

        broadcastProgress(jobId, { type: 'complete', outputFile: path.basename(outputFile) });
    } catch (error) {
        broadcastProgress(jobId, { type: 'error', message: error.message });
    }
}

// Upload
app.post('/api/transcribe', upload.single('file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }

    const jobId = `job_${Date.now()}`;
    const inputFile = req.file.path;
    const originalName = req.file.originalname;
    const outputFile = path.join('outputs', `${path.parse(originalName).name}.srt`);

    if (!fs.existsSync('outputs')) {
        fs.mkdirSync('outputs', { recursive: true });
    }

    jobs.set(jobId, { status: 'processing', inputFile, outputFile, originalName });

    processTranscription(jobId, inputFile, outputFile, originalName);

    res.json({ jobId, outputFile: path.basename(outputFile), originalName });
});

// SSE Progress
app.get('/api/progress/:jobId', (req, res) => {
    const { jobId } = req.params;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    clients.set(jobId, res);

    req.on('close', () => {
        clients.delete(jobId);
    });
});

// Download
app.get('/api/download/*', (req, res) => {
    const filename = decodeURIComponent(req.params[0]);
    let cleanName = filename.replace(/^outputs\//, '');
    const filePath = path.join('outputs', cleanName);

    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'File not found', path: filePath });
    }

    res.download(filePath, cleanName);
});

// List files
app.get('/api/files', (req, res) => {
    const files = [];

    if (!fs.existsSync('outputs')) {
        return res.json({ files: [] });
    }

    const outputFiles = fs.readdirSync('outputs').filter(f => f.endsWith('.srt'));

    // Build a map of srt filename to job directory by checking each job
    const jobMap = {};
    if (fs.existsSync('uploads')) {
        const jobDirs = fs.readdirSync('uploads').filter(d => {
            return fs.statSync(path.join('uploads', d)).isDirectory();
        });
        for (const jobDir of jobDirs) {
            // Check if this job has an original video file
            const jobPath = path.join('uploads', jobDir);
            const jobFiles = fs.readdirSync(jobPath);
            const originalFile = jobFiles.find(f => f.startsWith('original.'));
            if (originalFile) {
                // Try to find matching SRT in outputs (original filename without 'original' prefix)
                const originalName = path.parse(originalFile).name; // e.g., "original"
                // Check outputs for any SRT file and see if this job could be it
                // Since we don't store original names, we'll match by time proximity
            }
        }

        // Better approach: match by file creation time
        for (const srtFile of outputFiles) {
            const srtPath = path.join('outputs', srtFile);
            const srtStat = fs.statSync(srtPath);
            let bestMatch = null;
            let bestTimeDiff = Infinity;

            for (const jobDir of jobDirs) {
                const jobPath = path.join('uploads', jobDir);
                const originalPath = path.join(jobPath, 'original.mp4');
                if (fs.existsSync(originalPath)) {
                    const origStat = fs.statSync(originalPath);
                    const timeDiff = Math.abs(origStat.mtime.getTime() - srtStat.mtime.getTime());
                    if (timeDiff < bestTimeDiff) {
                        bestTimeDiff = timeDiff;
                        bestMatch = jobDir;
                    }
                }
            }
            if (bestMatch) {
                jobMap[srtFile] = bestMatch;
            }
        }
    }

    outputFiles.forEach(filename => {
        const filePath = path.join('outputs', filename);
        const stats = fs.statSync(filePath);
        const jobDir = jobMap[filename] || null;
        files.push({
            name: filename,
            originalName: filename.replace('.srt', ''),
            jobId: jobDir,
            status: 'complete',
            size: stats.size,
            created: stats.birthtime
        });
    });

    res.json({ files: files.sort((a, b) => new Date(b.created) - new Date(a.created)) });
});

// Stream video
app.get('/api/stream/*', (req, res) => {
    const filename = decodeURIComponent(req.params[0]);
    const uploadDir = path.join('uploads');

    // Check if request includes jobId (format: /api/stream/jobId/original or /api/stream/original?jobId=xxx)
    const urlParts = req.params[0].split('/');
    let jobId = req.query.jobId || null;
    let videoFilename = filename;

    // If first part looks like a job ID and second starts with 'original', use jobId
    if (urlParts.length >= 2 && urlParts[1].startsWith('original')) {
        jobId = urlParts[0];
        videoFilename = urlParts[1]; // Use the full filename like "original.mp4"
    } else if (urlParts.length === 1 && filename.startsWith('original')) {
        // Already has original prefix, use as-is
        videoFilename = filename;
    }

    if (!fs.existsSync(uploadDir)) {
        return res.status(404).json({ error: 'File not found' });
    }

    // If we have a jobId, try that directory first
    if (jobId) {
        const jobPath = path.join(uploadDir, jobId);
        if (fs.existsSync(jobPath)) {
            const dirFiles = fs.readdirSync(jobPath);
            const originalFile = dirFiles.find(f => f.startsWith('original.'));
            if (originalFile) {
                const filePath = path.join(jobPath, originalFile);
                const stat = fs.statSync(filePath);
                const fileSize = stat.size;
                const range = req.headers.range;

                if (range) {
                    const parts = range.replace(/bytes=/, '').split('-');
                    const start = parseInt(parts[0], 10);
                    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
                    const chunksize = end - start + 1;

                    res.writeHead(206, {
                        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                        'Accept-Ranges': 'bytes',
                        'Content-Length': chunksize,
                        'Content-Type': 'video/mp4'
                    });

                    fs.createReadStream(filePath, { start, end }).pipe(res);
                } else {
                    res.writeHead(200, {
                        'Content-Length': fileSize,
                        'Content-Type': 'video/mp4'
                    });
                    fs.createReadStream(filePath).pipe(res);
                }
                return;
            }
        }
    }

    // Fallback: search through job directories for matching SRT
    // Find job directory that has matching SRT output
    const srtName = videoFilename.includes('.') ? videoFilename : videoFilename + '.srt';
    const outputsDir = 'outputs';
    let matchedJobDir = null;

    if (fs.existsSync(outputsDir) && fs.existsSync(uploadDir)) {
        const outputFiles = fs.readdirSync(outputsDir);
        if (outputFiles.includes(srtName)) {
            // Find job directory that was used for this SRT by checking timestamps
            const srtStat = fs.statSync(path.join(outputsDir, srtName));
            const dirs = fs.readdirSync(uploadDir).filter(d => {
                try {
                    return fs.statSync(path.join(uploadDir, d)).isDirectory();
                } catch {
                    return false;
                }
            });

            for (const dir of dirs) {
                const jobPath = path.join(uploadDir, dir);
                if (fs.existsSync(path.join(jobPath, 'original.mp4'))) {
                    // Check if this job's original is close in time to the SRT
                    matchedJobDir = dir;
                    break; // Take first match for now
                }
            }
        }
    }

    // Also check in job subdirectories
    const dirs = fs.readdirSync(uploadDir).filter(d => {
        try {
            return fs.statSync(path.join(uploadDir, d)).isDirectory();
        } catch {
            return false;
        }
    });

    for (const dir of dirs) {
        const dirPath = path.join(uploadDir, dir);
        const dirFiles = fs.readdirSync(dirPath);
        // Check for exact filename match or "original" file with matching extension
        const matchedFile = dirFiles.find(f => {
            if (f === videoFilename || decodeURIComponent(f) === videoFilename) return true;
            // Check for original video file (original.mp4, original.mkv, etc.)
            if (f.startsWith('original') && path.extname(videoFilename) && f.includes(path.extname(videoFilename))) return true;
            // For backwards compatibility: match any original file
            if (f.startsWith('original') && !videoFilename.includes('.')) return true;
            return false;
        });
        if (matchedFile) {
            const filePath = path.join(dirPath, matchedFile);
            const stat = fs.statSync(filePath);
            const fileSize = stat.size;
            const range = req.headers.range;

            if (range) {
                const parts = range.replace(/bytes=/, '').split('-');
                const start = parseInt(parts[0], 10);
                const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
                const chunksize = end - start + 1;

                res.writeHead(206, {
                    'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                    'Accept-Ranges': 'bytes',
                    'Content-Length': chunksize,
                    'Content-Type': 'video/mp4'
                });

                fs.createReadStream(filePath, { start, end }).pipe(res);
            } else {
                res.writeHead(200, {
                    'Content-Length': fileSize,
                    'Content-Type': 'video/mp4'
                });
                fs.createReadStream(filePath).pipe(res);
            }
            return;
        }
    }

    // Also check in root uploads directory (original uploaded files)
    const rootFiles = fs.readdirSync(uploadDir);
    for (const file of rootFiles) {
        const filePath = path.join(uploadDir, file);
        try {
            const stat = fs.statSync(filePath);
            // Check if it's a file (not a directory) and has no extension (multer hash names)
            if (stat.isFile() && !path.extname(file)) {
                const fileSize = stat.size;
                const range = req.headers.range;

                if (range) {
                    const parts = range.replace(/bytes=/, '').split('-');
                    const start = parseInt(parts[0], 10);
                    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
                    const chunksize = end - start + 1;

                    res.writeHead(206, {
                        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                        'Accept-Ranges': 'bytes',
                        'Content-Length': chunksize,
                        'Content-Type': 'video/mp4'
                    });

                    fs.createReadStream(filePath, { start, end }).pipe(res);
                } else {
                    res.writeHead(200, {
                        'Content-Length': fileSize,
                        'Content-Type': 'video/mp4'
                    });
                    fs.createReadStream(filePath).pipe(res);
                }
                return;
            }
        } catch (e) {
            // Skip files that can't be accessed
        }
    }

    res.status(404).json({ error: 'File not found' });
});

// Update SRT content
app.post('/api/update-srt', (req, res) => {
    const { content, filename } = req.body;

    if (!content || !filename) {
        return res.status(400).json({ error: 'Missing content or filename' });
    }

    const filePath = path.join('outputs', filename);

    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'File not found' });
    }

    try {
        fs.writeFileSync(filePath, content, 'utf8');
        res.json({ success: true, message: 'SRT updated successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get SRT content
app.get('/api/srt/*', (req, res) => {
    let filename = decodeURIComponent(req.params[0]);
    if (filename.startsWith('outputs/')) filename = filename.slice(8);
    const filePath = path.join('outputs', filename);

    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'File not found' });
    }

    res.set('Content-Type', 'text/vtt');
    res.send(fs.readFileSync(filePath, 'utf8'));
});

const PORT = process.env.PORT || 28360;
const HOST = process.env.HOST || '0.0.0.0';
app.listen(PORT, HOST, () => {
    console.log(`Court Transcription Service running on http://${HOST}:${PORT}`);
});