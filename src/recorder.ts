import { t } from './i18n'

/**
 * Microphone capture for 上课中.
 *
 * "server" engine: records the mic in the browser, cuts it into short WAV
 * chunks at natural pauses (simple energy-based voice detection, so silence is
 * never sent), and hands each chunk to the caller to send to /api/transcribe.
 *
 * "browser" engine: the browser's built-in SpeechRecognition (free, live
 * partial results; Chrome needs Google's servers, which mainland China blocks).
 */

export interface Capture {
  stop(): Promise<void>
}

export interface AudioChunk {
  startedAt: number
  endedAt: number
  audio: Blob
}

const TARGET_RATE = 16000
const FRAME = TARGET_RATE / 10 // 100 ms

// Chunking rules, in 100 ms frames.
const MIN_FRAMES_BEFORE_PAUSE_CUT = 25 // 2.5 s
const PAUSE_FRAMES = 7 // 0.7 s of quiet ends a chunk
const MAX_FRAMES = 120 // never longer than 12 s
const LONG_SILENCE_FRAMES = 20 // 2 s of quiet always ends a chunk
const MIN_VOICED_FRAMES = 5 // ignore coughs/clicks under 0.5 s

const TAP_WORKLET = `
class CourseReplayTap extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0]
    if (channel) this.port.postMessage(channel.slice(0))
    return true
  }
}
registerProcessor('course-replay-tap', CourseReplayTap)
`

export function encodeWav(samples: Float32Array, sampleRate = TARGET_RATE): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)
  const write = (offset: number, text: string) => { for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i)) }
  write(0, 'RIFF'); view.setUint32(4, 36 + samples.length * 2, true); write(8, 'WAVE')
  write(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true)
  write(36, 'data'); view.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i++) {
    const value = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(44 + i * 2, value < 0 ? value * 0x8000 : value * 0x7fff, true)
  }
  return new Blob([buffer], { type: 'audio/wav' })
}

/** Downsamples to 16 kHz and splits speech into chunks at pauses. */
export class Segmenter {
  private readonly ratio: number
  private boundary: number
  private inputIndex = 0
  private acc = 0
  private accCount = 0
  private frame = new Float32Array(FRAME)
  private frameLength = 0
  private preroll: Float32Array[] = []
  private segment: Float32Array[] = []
  private segmentStart = 0
  private voiced = 0
  private quiet = 0
  private noise = 0.01

  constructor(sampleRate: number, private readonly onChunk: (chunk: AudioChunk) => void, private readonly onLevel?: (level: number) => void, private readonly now: () => number = Date.now) {
    this.ratio = sampleRate / TARGET_RATE
    this.boundary = this.ratio
  }

  push(input: Float32Array) {
    for (let i = 0; i < input.length; i++) {
      this.acc += input[i]
      this.accCount++
      this.inputIndex++
      if (this.inputIndex >= this.boundary) {
        this.frame[this.frameLength++] = this.acc / this.accCount
        this.acc = 0
        this.accCount = 0
        this.boundary += this.ratio
        if (this.frameLength === FRAME) {
          this.onFrame(this.frame)
          this.frame = new Float32Array(FRAME)
          this.frameLength = 0
        }
      }
    }
  }

  private onFrame(frame: Float32Array) {
    let sum = 0
    for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i]
    const rms = Math.sqrt(sum / frame.length)
    this.onLevel?.(Math.min(1, rms * 8))
    const speech = rms > Math.max(0.006, this.noise * 2.2)
    if (!this.segment.length) {
      if (speech) {
        this.segment = [...this.preroll, frame]
        this.segmentStart = this.now() - this.segment.length * 100
        this.voiced = 1
        this.quiet = 0
      } else {
        this.noise = Math.min(0.05, this.noise * 0.95 + rms * 0.05)
        this.preroll.push(frame)
        if (this.preroll.length > 3) this.preroll.shift()
      }
      return
    }
    this.segment.push(frame)
    if (speech) {
      this.voiced++
      this.quiet = 0
    } else {
      this.quiet++
      this.noise = Math.min(0.05, this.noise * 0.98 + rms * 0.02)
    }
    const frames = this.segment.length
    if ((frames >= MIN_FRAMES_BEFORE_PAUSE_CUT && this.quiet >= PAUSE_FRAMES) || frames >= MAX_FRAMES || this.quiet >= LONG_SILENCE_FRAMES) this.emit()
  }

  flush() {
    if (this.segment.length) this.emit()
  }

  private emit() {
    const frames = this.segment
    const trailingQuiet = this.quiet
    const voiced = this.voiced
    this.segment = []
    this.preroll = []
    this.voiced = 0
    this.quiet = 0
    if (voiced < MIN_VOICED_FRAMES) return
    const keep = frames.slice(0, frames.length - Math.max(0, trailingQuiet - 3))
    const samples = new Float32Array(keep.length * FRAME)
    keep.forEach((frame, index) => samples.set(frame, index * FRAME))
    this.onChunk({ startedAt: this.segmentStart, endedAt: this.now(), audio: encodeWav(samples) })
  }
}

function micErrorMessage(error: unknown) {
  const name = error instanceof DOMException ? error.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError') return t('麦克风权限被拒绝：请在浏览器地址栏允许使用麦克风')
  if (name === 'NotFoundError') return t('没有找到麦克风')
  if (name === 'NotReadableError') return t('麦克风被其他程序占用')
  return error instanceof Error ? error.message : t('无法打开麦克风')
}

export async function startServerCapture(handlers: { onChunk: (chunk: AudioChunk) => void; onLevel: (level: number) => void; onError: (message: string) => void }): Promise<Capture> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error(t('当前浏览器不能录音（需要 HTTPS 或 localhost）'))
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: false, noiseSuppression: true, autoGainControl: true } })
  } catch (error) {
    throw new Error(micErrorMessage(error))
  }
  const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  const context = new AudioCtx()
  try {
    if (context.state === 'suspended') await context.resume().catch(() => undefined)
    const moduleUrl = URL.createObjectURL(new Blob([TAP_WORKLET], { type: 'application/javascript' }))
    await context.audioWorklet.addModule(moduleUrl)
    URL.revokeObjectURL(moduleUrl)
  } catch (error) {
    stream.getTracks().forEach((track) => track.stop())
    await context.close().catch(() => undefined)
    throw new Error(error instanceof Error ? error.message : t('无法打开麦克风'))
  }
  const source = context.createMediaStreamSource(stream)
  const tap = new AudioWorkletNode(context, 'course-replay-tap')
  const mute = context.createGain()
  mute.gain.value = 0
  source.connect(tap)
  tap.connect(mute)
  mute.connect(context.destination) // keeps the graph pulling without playing anything
  const segmenter = new Segmenter(context.sampleRate, handlers.onChunk, handlers.onLevel)
  tap.port.onmessage = (event: MessageEvent<Float32Array>) => segmenter.push(event.data)
  const track = stream.getAudioTracks()[0]
  const onEnded = () => handlers.onError(t('麦克风已断开'))
  track?.addEventListener('ended', onEnded)
  return {
    async stop() {
      track?.removeEventListener('ended', onEnded)
      segmenter.flush()
      tap.port.onmessage = null
      source.disconnect()
      tap.disconnect()
      mute.disconnect()
      stream.getTracks().forEach((item) => item.stop())
      await context.close().catch(() => undefined)
    },
  }
}

type RecognitionResultList = ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>
interface Recognition {
  continuous: boolean
  interimResults: boolean
  lang: string
  onresult: ((event: { resultIndex: number; results: RecognitionResultList }) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
}

export function startBrowserCapture(language: 'zh' | 'en', handlers: { onFinal: (text: string, startedAt: number, endedAt: number) => void; onInterim: (text: string) => void; onError: (message: string) => void }): Capture {
  const Recognizer = (window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition }).SpeechRecognition
    || (window as unknown as { webkitSpeechRecognition?: new () => Recognition }).webkitSpeechRecognition
  if (!Recognizer) throw new Error(t('这个浏览器没有内置语音识别，请在设置里改用服务器转写'))
  const recognition = new Recognizer()
  recognition.continuous = true
  recognition.interimResults = true
  recognition.lang = language === 'en' ? 'en-US' : 'zh-CN'
  let stopped = false
  let segmentStart = Date.now()
  recognition.onresult = (event) => {
    let interim = ''
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i]
      if (result.isFinal) {
        const text = result[0].transcript.trim()
        if (text) handlers.onFinal(text, segmentStart, Date.now())
        segmentStart = Date.now()
      } else {
        interim += result[0].transcript
      }
    }
    handlers.onInterim(interim)
  }
  recognition.onerror = (event) => {
    if (event.error === 'no-speech' || event.error === 'aborted') return
    stopped = true
    handlers.onError(
      event.error === 'not-allowed' ? t('麦克风权限被拒绝：请在浏览器地址栏允许使用麦克风')
        : event.error === 'network' ? t('浏览器语音服务连不上（国内网络下 Chrome 的内置识别不可用），请在设置里改用服务器转写')
          : t('浏览器语音识别出错：{error}', { error: event.error }),
    )
  }
  // Chrome ends recognition after a while; keep it going until the user stops.
  recognition.onend = () => { if (!stopped) { try { recognition.start() } catch { /* already started */ } } }
  recognition.start()
  return {
    async stop() {
      stopped = true
      handlers.onInterim('')
      recognition.stop()
    },
  }
}

/** Record a short clip (for the 设置 microphone test) as 16 kHz WAV. */
export async function recordClip(durationMs: number, onLevel?: (level: number) => void): Promise<Blob> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error(t('当前浏览器不能录音（需要 HTTPS 或 localhost）'))
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: false, noiseSuppression: true, autoGainControl: true } })
  } catch (error) {
    throw new Error(micErrorMessage(error))
  }
  const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  const context = new AudioCtx()
  try {
    const moduleUrl = URL.createObjectURL(new Blob([TAP_WORKLET], { type: 'application/javascript' }))
    await context.audioWorklet.addModule(moduleUrl)
    URL.revokeObjectURL(moduleUrl)
    const source = context.createMediaStreamSource(stream)
    const tap = new AudioWorkletNode(context, 'course-replay-tap')
    const mute = context.createGain()
    mute.gain.value = 0
    source.connect(tap); tap.connect(mute); mute.connect(context.destination)
    const chunks: Float32Array[] = []
    tap.port.onmessage = (event: MessageEvent<Float32Array>) => {
      chunks.push(event.data)
      if (onLevel) {
        let sum = 0
        for (let i = 0; i < event.data.length; i++) sum += event.data[i] * event.data[i]
        onLevel(Math.min(1, Math.sqrt(sum / event.data.length) * 8))
      }
    }
    await new Promise((resolve) => window.setTimeout(resolve, durationMs))
    tap.port.onmessage = null
    const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
    const raw = new Float32Array(total)
    let offset = 0
    chunks.forEach((chunk) => { raw.set(chunk, offset); offset += chunk.length })
    const ratio = context.sampleRate / TARGET_RATE
    const out = new Float32Array(Math.floor(raw.length / ratio))
    for (let i = 0; i < out.length; i++) out[i] = raw[Math.floor(i * ratio)]
    return encodeWav(out)
  } finally {
    stream.getTracks().forEach((track) => track.stop())
    await context.close().catch(() => undefined)
  }
}
