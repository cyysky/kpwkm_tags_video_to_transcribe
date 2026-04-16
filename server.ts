import "dotenv/config";
import express from "express";
import multer from "multer";
import cors from "cors";
import axios from "axios";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import FormData from "form-data";
import { exec } from "child_process";
import fs from "fs";
import path from "path";
import { promisify } from "util";
import prisma from "./src/server/db";

const execAsync = promisify(exec);

const app = express();
const upload = multer({ dest: "uploads/" });

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configuration from environment variables
const VLLM_API_URL = process.env.VLLM_API_URL || "http://localhost:9999";
const VLLM_API_KEY = process.env.VLLM_API_KEY || "api-key";
const VLLM_MODEL = process.env.VLLM_MODEL || "qwen3-asr-1.7b";
const VLLM_API_BASE = `${VLLM_API_URL}/v1`;
const JWT_SECRET = process.env.JWT_SECRET || "change-me-in-production";

const CHUNK_DURATION = 15;
const MAX_WORKERS = 30;
const CHUNK_WORKERS = 20;

type Segment = {
  start: number;
  end: number;
  text: string;
};

type Chunk = {
  file: string;
  start: number;
  end: number;
};

const jobs = new Map<string, unknown>();
const clients = new Map<string, express.Response>();

function formatSrtTimestamp(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const millis = Math.floor((seconds % 1) * 1000);
  return `${hours.toString().padStart(2, "0")}:${minutes
    .toString()
    .padStart(2, "0")}:${secs.toString().padStart(2, "0")},${millis
    .toString()
    .padStart(3, "0")}`;
}

function formatSrt(segments: Segment[]) {
  if (!segments || segments.length === 0) return "";

  const srtLines: Array<string | number> = [];
  segments.forEach((seg, i) => {
    const start = seg.start || 0;
    const end = seg.end || start + 2;
    const text = (seg.text || "").trim();

    srtLines.push(i + 1);
    srtLines.push(`${formatSrtTimestamp(start)} --> ${formatSrtTimestamp(end)}`);
    srtLines.push(text);
    srtLines.push("");
  });

  return srtLines.join("\n");
}

async function getAudioDuration(mp3File: string) {
  const cmd = [
    "ffprobe",
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    mp3File
  ];
  const { stdout } = await execAsync(cmd.join(" "));
  return parseFloat(stdout.trim());
}

function broadcastProgress(jobId: string, data: unknown) {
  const client = clients.get(jobId);
  if (client) {
    client.write(`data: ${JSON.stringify(data)}\n\n`);
  }
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function signToken(user: { id: string; email: string }) {
  return jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, {
    expiresIn: "7d"
  });
}

async function splitAudioChunk(args: {
  mp3File: string;
  outputDir: string;
  start: number;
  end: number;
}): Promise<Chunk> {
  const { mp3File, outputDir, start, end } = args;
  const chunkFile = path.join(
    outputDir,
    `chunk_${start.toString().padStart(6, "0")}_${end
      .toString()
      .padStart(6, "0")}.mp3`
  );

  const cmd = [
    "ffmpeg",
    "-i",
    mp3File,
    "-ss",
    start.toString(),
    "-t",
    (end - start).toString(),
    "-vn",
    "-acodec",
    "libmp3lame",
    "-q:a",
    "2",
    "-y",
    chunkFile
  ];

  await execAsync(cmd.join(" "));
  return { file: chunkFile, start, end };
}

async function splitAudioToChunks(mp3File: string, outputDir: string, jobId: string) {
  const duration = await getAudioDuration(mp3File);
  const chunkArgs: Array<{ mp3File: string; outputDir: string; start: number; end: number }> = [];

  for (let start = 0; start < Math.ceil(duration); start += CHUNK_DURATION) {
    const end = Math.min(start + CHUNK_DURATION, Math.ceil(duration));
    chunkArgs.push({ mp3File, outputDir, start, end });
  }

  broadcastProgress(jobId, {
    type: "status",
    message: `Splitting into ${chunkArgs.length} chunks...`
  });

  const chunks: Chunk[] = [];
  for (let i = 0; i < chunkArgs.length; i += CHUNK_WORKERS) {
    const batch = chunkArgs.slice(i, i + CHUNK_WORKERS);
    const results = await Promise.all(batch.map((args) => splitAudioChunk(args)));
    chunks.push(...results);
    broadcastProgress(jobId, {
      type: "status",
      message: `Split chunk ${Math.min(i + CHUNK_WORKERS, chunkArgs.length)}/${chunkArgs.length}`
    });
  }

  chunks.sort((a, b) => a.start - b.start);
  broadcastProgress(jobId, { type: "chunks-created", count: chunks.length });
  return chunks;
}

async function transcribeChunk(chunk: Chunk, jobId: string, chunkIndex: number, totalChunks: number) {
  const { file, start, end } = chunk;
  const audioData = fs.readFileSync(file);
  const formData = new FormData();
  formData.append("file", audioData, {
    filename: "audio.mp3",
    contentType: "audio/mpeg"
  });
  formData.append("model", VLLM_MODEL);
  formData.append("response_format", "json");

  let segments: any[] | null = null;
  let plainText = "";

  try {
    const response = await axios.post(`${VLLM_API_BASE}/audio/transcriptions`, formData, {
      headers: {
        ...formData.getHeaders(),
        Authorization: `Bearer ${VLLM_API_KEY}`
      },
      timeout: 600000
    });

    const result = response.data;
    if (result && typeof result === "object") {
      segments = (result as any).segments;
      plainText = (result as any).text || "";
    }
  } catch (error) {
    const err = error as Error;
    console.error(`Chunk ${chunkIndex + 1} failed:`, err.message);
  }

  const adjustedSegments: Segment[] = [];
  if (segments && segments.length > 0) {
    segments.forEach((seg) => {
      const text = (seg.text || "").trim();
      if (text) {
        adjustedSegments.push({
          start: (seg.start || 0) + start,
          end: (seg.end || 0) + start,
          text
        });
      }
    });
  } else if (plainText) {
    adjustedSegments.push({
      start,
      end,
      text: plainText.trim()
    });
  }

  broadcastProgress(jobId, {
    type: "chunk-complete",
    chunkIndex: chunkIndex + 1,
    totalChunks,
    start: start.toFixed(1),
    end: end.toFixed(1)
  });

  return adjustedSegments;
}

async function processTranscription(
  jobId: string,
  inputFile: string,
  outputFile: string,
  originalName: string
) {
  const tempDir = path.join("uploads", jobId);
  const mp3File = path.join(tempDir, "audio.mp3");

  try {
    fs.mkdirSync(tempDir, { recursive: true });

    const originalExt = path.extname(originalName);
    const videoFileInJob = path.join(tempDir, `original${originalExt}`);
    fs.copyFileSync(inputFile, videoFileInJob);

    broadcastProgress(jobId, { type: "status", message: "Extracting audio..." });

    const convertCmd = [
      "ffmpeg",
      "-i",
      inputFile,
      "-vn",
      "-acodec",
      "libmp3lame",
      "-q:a",
      "2",
      "-y",
      mp3File
    ];
    await execAsync(convertCmd.join(" "));

    broadcastProgress(jobId, { type: "status", message: "Splitting into chunks..." });
    const chunks = await splitAudioToChunks(mp3File, tempDir, jobId);

    broadcastProgress(jobId, { type: "status", message: "Transcribing chunks..." });

    const allSegments: Segment[] = [];
    for (let i = 0; i < chunks.length; i += MAX_WORKERS) {
      const batch = chunks.slice(i, i + MAX_WORKERS);
      const batchPromises = batch.map((chunk, idx) =>
        transcribeChunk(chunk, jobId, i + idx, chunks.length)
      );
      const results = await Promise.all(batchPromises);
      results.forEach((seg) => allSegments.push(...seg));
    }

    allSegments.sort((a, b) => a.start - b.start);
    const srtContent = formatSrt(allSegments);
    fs.writeFileSync(outputFile, srtContent, "utf8");

    broadcastProgress(jobId, { type: "complete", outputFile: path.basename(outputFile) });
  } catch (error) {
    const err = error as Error;
    broadcastProgress(jobId, { type: "error", message: err.message });
  }
}

app.post("/api/auth/signup", async (req, res) => {
  try {
    const { email, password } = req.body;
    const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";

    if (!isValidEmail(normalizedEmail)) {
      return res.status(400).json({ error: "Please provide a valid email address." });
    }
    if (typeof password !== "string" || password.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters long." });
    }

    const existingUser = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existingUser) {
      return res.status(409).json({ error: "An account with this email already exists." });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: { email: normalizedEmail, passwordHash },
      select: { id: true, email: true }
    });

    const token = signToken(user);
    return res.status(201).json({ token, user });
  } catch (error) {
    console.error("Signup error:", error);
    return res.status(500).json({ error: "Could not create account." });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";

    if (!isValidEmail(normalizedEmail) || typeof password !== "string" || password.length === 0) {
      return res.status(400).json({ error: "Email and password are required." });
    }

    const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (!user) {
      return res.status(401).json({ error: "Invalid email or password." });
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      return res.status(401).json({ error: "Invalid email or password." });
    }

    const token = signToken({ id: user.id, email: user.email });
    return res.json({
      token,
      user: { id: user.id, email: user.email }
    });
  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json({ error: "Could not log in." });
  }
});

app.post("/api/transcribe", upload.single("file"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded" });
  }

  const jobId = `job_${Date.now()}`;
  const inputFile = req.file.path;
  const originalName = req.file.originalname;
  const outputFile = path.join("outputs", `${path.parse(originalName).name}.srt`);

  if (!fs.existsSync("outputs")) {
    fs.mkdirSync("outputs", { recursive: true });
  }

  jobs.set(jobId, { status: "processing", inputFile, outputFile, originalName });

  processTranscription(jobId, inputFile, outputFile, originalName);

  res.json({ jobId, outputFile: path.basename(outputFile), originalName });
});

app.get("/api/progress/:jobId", (req, res) => {
  const { jobId } = req.params;
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  clients.set(jobId, res);
  req.on("close", () => {
    clients.delete(jobId);
  });
});

app.get("/api/download/*", (req, res) => {
  const filename = decodeURIComponent(req.params[0]);
  const cleanName = filename.replace(/^outputs\//, "");
  const filePath = path.join("outputs", cleanName);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "File not found", path: filePath });
  }

  res.download(filePath, cleanName);
});

app.get("/api/files", (_req, res) => {
  const files: Array<{
    name: string;
    originalName: string;
    jobId: string | null;
    status: string;
    size: number;
    created: Date;
  }> = [];

  if (!fs.existsSync("outputs")) {
    return res.json({ files: [] });
  }

  const outputFiles = fs.readdirSync("outputs").filter((f) => f.endsWith(".srt"));

  const jobMap: Record<string, string> = {};
  if (fs.existsSync("uploads")) {
    const jobDirs = fs
      .readdirSync("uploads")
      .filter((d) => fs.statSync(path.join("uploads", d)).isDirectory());

    for (const srtFile of outputFiles) {
      const srtPath = path.join("outputs", srtFile);
      const srtStat = fs.statSync(srtPath);
      let bestMatch: string | null = null;
      let bestTimeDiff = Infinity;

      for (const jobDir of jobDirs) {
        const jobPath = path.join("uploads", jobDir);
        const originalPath = path.join(jobPath, "original.mp4");
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

  outputFiles.forEach((filename) => {
    const filePath = path.join("outputs", filename);
    const stats = fs.statSync(filePath);
    const jobDir = jobMap[filename] || null;
    files.push({
      name: filename,
      originalName: filename.replace(".srt", ""),
      jobId: jobDir,
      status: "complete",
      size: stats.size,
      created: stats.birthtime
    });
  });

  res.json({ files: files.sort((a, b) => new Date(b.created).getTime() - new Date(a.created).getTime()) });
});

app.get("/api/stream/*", (req, res) => {
  const filename = decodeURIComponent(req.params[0]);
  const uploadDir = path.join("uploads");
  const urlParts = req.params[0].split("/");
  let jobId = typeof req.query.jobId === "string" ? req.query.jobId : null;
  let videoFilename = filename;

  if (urlParts.length >= 2 && urlParts[1].startsWith("original")) {
    jobId = urlParts[0];
    videoFilename = urlParts[1];
  } else if (urlParts.length === 1 && filename.startsWith("original")) {
    videoFilename = filename;
  }

  if (!fs.existsSync(uploadDir)) {
    return res.status(404).json({ error: "File not found" });
  }

  if (jobId) {
    const jobPath = path.join(uploadDir, jobId);
    if (fs.existsSync(jobPath)) {
      const dirFiles = fs.readdirSync(jobPath);
      const originalFile = dirFiles.find((f) => f.startsWith("original."));
      if (originalFile) {
        const filePath = path.join(jobPath, originalFile);
        const stat = fs.statSync(filePath);
        const fileSize = stat.size;
        const range = req.headers.range;

        if (range) {
          const parts = range.replace(/bytes=/, "").split("-");
          const start = Number.parseInt(parts[0], 10);
          const end = parts[1] ? Number.parseInt(parts[1], 10) : fileSize - 1;
          const chunksize = end - start + 1;

          res.writeHead(206, {
            "Content-Range": `bytes ${start}-${end}/${fileSize}`,
            "Accept-Ranges": "bytes",
            "Content-Length": chunksize,
            "Content-Type": "video/mp4"
          });

          fs.createReadStream(filePath, { start, end }).pipe(res);
        } else {
          res.writeHead(200, {
            "Content-Length": fileSize,
            "Content-Type": "video/mp4"
          });
          fs.createReadStream(filePath).pipe(res);
        }
        return;
      }
    }
  }

  const dirs = fs.readdirSync(uploadDir).filter((d) => {
    try {
      return fs.statSync(path.join(uploadDir, d)).isDirectory();
    } catch {
      return false;
    }
  });

  for (const dir of dirs) {
    const dirPath = path.join(uploadDir, dir);
    const dirFiles = fs.readdirSync(dirPath);
    const matchedFile = dirFiles.find((f) => {
      if (f === videoFilename || decodeURIComponent(f) === videoFilename) return true;
      if (f.startsWith("original") && path.extname(videoFilename) && f.includes(path.extname(videoFilename))) {
        return true;
      }
      if (f.startsWith("original") && !videoFilename.includes(".")) return true;
      return false;
    });

    if (matchedFile) {
      const filePath = path.join(dirPath, matchedFile);
      const stat = fs.statSync(filePath);
      const fileSize = stat.size;
      const range = req.headers.range;

      if (range) {
        const parts = range.replace(/bytes=/, "").split("-");
        const start = Number.parseInt(parts[0], 10);
        const end = parts[1] ? Number.parseInt(parts[1], 10) : fileSize - 1;
        const chunksize = end - start + 1;

        res.writeHead(206, {
          "Content-Range": `bytes ${start}-${end}/${fileSize}`,
          "Accept-Ranges": "bytes",
          "Content-Length": chunksize,
          "Content-Type": "video/mp4"
        });

        fs.createReadStream(filePath, { start, end }).pipe(res);
      } else {
        res.writeHead(200, {
          "Content-Length": fileSize,
          "Content-Type": "video/mp4"
        });
        fs.createReadStream(filePath).pipe(res);
      }
      return;
    }
  }

  const rootFiles = fs.readdirSync(uploadDir);
  for (const file of rootFiles) {
    const filePath = path.join(uploadDir, file);
    try {
      const stat = fs.statSync(filePath);
      if (stat.isFile() && !path.extname(file)) {
        const fileSize = stat.size;
        const range = req.headers.range;

        if (range) {
          const parts = range.replace(/bytes=/, "").split("-");
          const start = Number.parseInt(parts[0], 10);
          const end = parts[1] ? Number.parseInt(parts[1], 10) : fileSize - 1;
          const chunksize = end - start + 1;

          res.writeHead(206, {
            "Content-Range": `bytes ${start}-${end}/${fileSize}`,
            "Accept-Ranges": "bytes",
            "Content-Length": chunksize,
            "Content-Type": "video/mp4"
          });

          fs.createReadStream(filePath, { start, end }).pipe(res);
        } else {
          res.writeHead(200, {
            "Content-Length": fileSize,
            "Content-Type": "video/mp4"
          });
          fs.createReadStream(filePath).pipe(res);
        }
        return;
      }
    } catch {
      // Skip files that can't be accessed
    }
  }

  res.status(404).json({ error: "File not found" });
});

app.post("/api/update-srt", (req, res) => {
  const { content, filename } = req.body;
  if (!content || !filename) {
    return res.status(400).json({ error: "Missing content or filename" });
  }

  const filePath = path.join("outputs", filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "File not found" });
  }

  try {
    fs.writeFileSync(filePath, content, "utf8");
    res.json({ success: true, message: "SRT updated successfully" });
  } catch (error) {
    const err = error as Error;
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/srt/*", (req, res) => {
  let filename = decodeURIComponent(req.params[0]);
  if (filename.startsWith("outputs/")) filename = filename.slice(8);
  const filePath = path.join("outputs", filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "File not found" });
  }

  res.set("Content-Type", "text/vtt");
  res.send(fs.readFileSync(filePath, "utf8"));
});

const PORT = process.env.PORT || 28360;
const HOST = process.env.HOST || "0.0.0.0";
app.listen(PORT, HOST, () => {
  console.log(`Court Transcription Service running on http://${HOST}:${PORT}`);
});
