import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

// Core files CDN - these need to be loaded as blob URLs
const CORE_URL = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm/ffmpeg-core.js";
const WASM_URL = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm/ffmpeg-core.wasm";

export class VideoService {
  private ffmpeg: FFmpeg;
  private loaded: boolean = false;

  constructor() {
    this.ffmpeg = new FFmpeg();
  }

  async load(onLog: (msg: string) => void) {
    if (this.loaded) return;

    onLog("Loading video engine...");

    try {
      // Set up logging
      this.ffmpeg.on('log', ({ message }) => {
        if (message && !message.startsWith('frame=')) {
          onLog(message);
        }
      });

      // Load core files as blob URLs to avoid CORS issues
      onLog("Downloading core files...");
      const coreURL = await toBlobURL(CORE_URL, 'text/javascript');
      const wasmURL = await toBlobURL(WASM_URL, 'application/wasm');

      onLog("Loading worker...");
      await this.ffmpeg.load({
        coreURL,
        wasmURL,
      });

      this.loaded = true;
      onLog("Engine ready!");
    } catch (error: any) {
      console.error("FFmpeg load failed:", error);
      throw new Error(`Engine load failed: ${error.message || "Unknown error"}`);
    }
  }

  /**
   * Convert HH:MM:SS to H:MM:SS format for ASS
   */
  private convertToAssTime(hhmmss: string, ms: string): string {
    const parts = hhmmss.split(':');
    const h = parseInt(parts[0], 10);
    const mm = parts[1];
    const ss = parts[2];
    const cc = ms.slice(0, 2); // centiseconds
    return `${h}:${mm}:${ss}.${cc}`;
  }

  /**
   * Normalize SRT timing to proper HH:MM:SS,mmm format
   * Handles various malformed formats from Gemini
   */
  private normalizeSrtTiming(srtContent: string): string {
    const lines = srtContent.split(/\r?\n/);
    const result: string[] = [];
    
    for (const line of lines) {
      if (line.includes('-->')) {
        // Parse and fix timing line
        const normalized = this.fixTimingLine(line);
        result.push(normalized);
        console.log('Timing line:', line, '->', normalized);
      } else {
        result.push(line);
      }
    }
    
    return result.join('\n');
  }

  /**
   * Fix a single timing line to proper SRT format
   */
  private fixTimingLine(line: string): string {
    // Extract start and end times
    const parts = line.split('-->').map(s => s.trim());
    if (parts.length !== 2) return line;
    
    const startFixed = this.fixSingleTime(parts[0]);
    const endFixed = this.fixSingleTime(parts[1]);
    
    return `${startFixed} --> ${endFixed}`;
  }

  /**
   * Get audio duration in seconds
   */
  private async getAudioDuration(audioFile: File): Promise<number> {
    return new Promise((resolve) => {
      const audio = new Audio();
      audio.src = URL.createObjectURL(audioFile);
      audio.onloadedmetadata = () => {
        URL.revokeObjectURL(audio.src);
        resolve(audio.duration || 180); // fallback to 3 minutes
      };
      audio.onerror = () => {
        resolve(180); // fallback to 3 minutes
      };
    });
  }

  /**
   * Load image from Blob
   */
  private async loadImage(imageBlob: Blob): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(img.src);
        resolve(img);
      };
      img.onerror = reject;
      img.src = URL.createObjectURL(imageBlob);
    });
  }

  /**
   * Render a frame with subtitle using Canvas
   */
  private async renderFrame(
    baseImage: HTMLImageElement,
    subtitle: string,
    width: number,
    height: number
  ): Promise<Uint8Array> {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;

    // Draw base image (scaled to fit)
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, width, height);
    
    // Calculate image scaling to cover the canvas
    const scale = Math.max(width / baseImage.width, height / baseImage.height);
    const scaledWidth = baseImage.width * scale;
    const scaledHeight = baseImage.height * scale;
    const x = (width - scaledWidth) / 2;
    const y = (height - scaledHeight) / 2;
    
    ctx.drawImage(baseImage, x, y, scaledWidth, scaledHeight);

    // Draw subtitle if present
    if (subtitle) {
      const fontSize = 48;
      ctx.font = `bold ${fontSize}px "Microsoft YaHei", "PingFang SC", "Noto Sans SC", Arial, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      // Measure text and wrap if needed
      const maxWidth = width - 60;
      const lines = this.wrapText(ctx, subtitle, maxWidth);
      const lineHeight = fontSize * 1.3;
      const totalHeight = lines.length * lineHeight;
      const startY = height / 2 - totalHeight / 2 + lineHeight / 2;

      // Draw each line
      lines.forEach((line, index) => {
        const lineY = startY + index * lineHeight;
        
        // Draw black outline
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 6;
        ctx.lineJoin = 'round';
        ctx.strokeText(line, width / 2, lineY);
        
        // Draw white fill
        ctx.fillStyle = '#FFFFFF';
        ctx.fillText(line, width / 2, lineY);
      });
    }

    // Convert canvas to JPEG bytes
    const blob = await new Promise<Blob>((resolve) => {
      canvas.toBlob((b) => resolve(b!), 'image/jpeg', 0.9);
    });
    
    return new Uint8Array(await blob.arrayBuffer());
  }

  /**
   * Wrap text to fit within maxWidth
   */
  private wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
    const words = text.split('');
    const lines: string[] = [];
    let currentLine = '';

    for (const char of words) {
      const testLine = currentLine + char;
      const metrics = ctx.measureText(testLine);
      
      if (metrics.width > maxWidth && currentLine) {
        lines.push(currentLine);
        currentLine = char;
      } else {
        currentLine = testLine;
      }
    }
    
    if (currentLine) {
      lines.push(currentLine);
    }
    
    return lines;
  }

  /**
   * Parse SRT content and return array of subtitle objects with timing in seconds
   */
  private parseSrtToSubtitles(srtContent: string): Array<{text: string, startSec: number, endSec: number}> {
    const blocks = srtContent.trim().split(/\r?\n\r?\n+/);
    const subtitles: Array<{text: string, startSec: number, endSec: number}> = [];

    for (const block of blocks) {
      const lines = block.split(/\r?\n/);
      if (lines.length < 2) continue;

      // Find timing line
      let timingLine = '';
      let textStartIndex = 0;

      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('-->')) {
          timingLine = lines[i];
          textStartIndex = i + 1;
          break;
        }
      }

      if (!timingLine) continue;

      // Parse timing
      const parts = timingLine.split('-->').map(s => s.trim());
      if (parts.length !== 2) continue;

      const startSec = this.timeToSeconds(parts[0]);
      const endSec = this.timeToSeconds(parts[1]);

      if (startSec === null || endSec === null) {
        console.log('Failed to parse timing:', timingLine);
        continue;
      }

      // Get text
      const textLines = lines.slice(textStartIndex).filter(l => l.trim());
      const text = textLines.join(' ');

      if (text) {
        subtitles.push({ text, startSec, endSec });
        console.log(`Subtitle: ${startSec}s - ${endSec}s: ${text.slice(0, 30)}...`);
      }
    }

    return subtitles;
  }

  /**
   * Convert timestamp string to seconds
   */
  private timeToSeconds(time: string): number | null {
    time = time.trim();
    
    // Split by separators
    const parts = time.split(/[:,\.]/);
    
    let hours = 0, minutes = 0, seconds = 0, ms = 0;
    
    if (parts.length === 4) {
      // HH:MM:SS,mmm
      hours = parseInt(parts[0], 10) || 0;
      minutes = parseInt(parts[1], 10) || 0;
      seconds = parseInt(parts[2], 10) || 0;
      ms = parseInt(parts[3], 10) || 0;
    } else if (parts.length === 3) {
      // Could be MM:SS,mmm or MM:SS:mmm
      const p1 = parseInt(parts[0], 10) || 0;
      const p2 = parseInt(parts[1], 10) || 0;
      const p3 = parseInt(parts[2], 10) || 0;
      
      if (p3 > 59 || parts[2].length === 3) {
        // MM:SS,mmm
        minutes = p1;
        seconds = p2;
        ms = p3;
      } else {
        // HH:MM:SS
        hours = p1;
        minutes = p2;
        seconds = p3;
      }
    } else if (parts.length === 2) {
      // MM:SS
      minutes = parseInt(parts[0], 10) || 0;
      seconds = parseInt(parts[1], 10) || 0;
    } else {
      return null;
    }
    
    return hours * 3600 + minutes * 60 + seconds + ms / 1000;
  }

  /**
   * Fix a single timestamp to HH:MM:SS,mmm format
   */
  private fixSingleTime(time: string): string {
    // Remove any extra whitespace
    time = time.trim();
    
    // Replace all separators with consistent format for parsing
    // Handle formats like: 00:00:13,300 | 00:13:300 | 00:13,300 | 01:06:00,000
    
    // Split by common separators
    const parts = time.split(/[:,\.]/);
    
    if (parts.length === 4) {
      // Format: HH:MM:SS,mmm or HH:MM:SS:mmm
      const [hh, mm, ss, mmm] = parts;
      return `${hh.padStart(2, '0')}:${mm.padStart(2, '0')}:${ss.padStart(2, '0')},${mmm.padEnd(3, '0').slice(0, 3)}`;
    } else if (parts.length === 3) {
      // Could be MM:SS,mmm (missing hours) or MM:SS:mmm
      const [p1, p2, p3] = parts;
      
      // Check if it looks like MM:SS,mmm (p3 is milliseconds)
      if (parseInt(p3) > 59 || p3.length === 3) {
        // Treat as MM:SS,mmm -> 00:MM:SS,mmm
        return `00:${p1.padStart(2, '0')}:${p2.padStart(2, '0')},${p3.padEnd(3, '0').slice(0, 3)}`;
      } else {
        // Treat as HH:MM:SS -> HH:MM:SS,000
        return `${p1.padStart(2, '0')}:${p2.padStart(2, '0')}:${p3.padStart(2, '0')},000`;
      }
    } else if (parts.length === 2) {
      // MM:SS format -> 00:MM:SS,000
      const [mm, ss] = parts;
      return `00:${mm.padStart(2, '0')}:${ss.padStart(2, '0')},000`;
    }
    
    // Can't parse, return as-is
    console.warn('Could not parse time:', time);
    return time;
  }

  /**
   * Parse SRT content and convert to ASS format for burning subtitles
   */
  private srtToAss(srtContent: string): string {
    // ASS header with larger, more visible font
    const header = `[Script Info]
Title: Lyrics
ScriptType: v4.00+
WrapStyle: 0
ScaledBorderAndShadow: yes
YCbCr Matrix: None
PlayResX: 1920
PlayResY: 1080

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,72,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,4,2,2,20,20,60,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

    const blocks = srtContent.trim().split(/\r?\n\r?\n+/);
    const events: string[] = [];

    console.log('SRT blocks found:', blocks.length);

    for (const block of blocks) {
      const lines = block.split(/\r?\n/);
      if (lines.length < 2) continue;

      // Find the timing line (might be first or second line)
      let timingLine = '';
      let textStartIndex = 0;
      
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('-->')) {
          timingLine = lines[i];
          textStartIndex = i + 1;
          break;
        }
      }

      if (!timingLine) continue;

      // Parse timing - handle multiple formats:
      // Standard: 00:00:01,000 --> 00:00:04,000 (HH:MM:SS,mmm)
      // Non-standard: 00:01:000 --> 00:04:000 (MM:SS:mmm)
      
      let startTime = '';
      let endTime = '';
      
      // Try standard format first: HH:MM:SS,mmm or HH:MM:SS.mmm
      const standardMatch = timingLine.match(/(\d{1,2}:\d{2}:\d{2})[,.](\d{3})\s*-->\s*(\d{1,2}:\d{2}:\d{2})[,.](\d{3})/);
      
      if (standardMatch) {
        startTime = this.convertToAssTime(standardMatch[1], standardMatch[2]);
        endTime = this.convertToAssTime(standardMatch[3], standardMatch[4]);
      } else {
        // Try non-standard format: MM:SS:mmm or MM:SS,mmm (missing hours)
        const nonStandardMatch = timingLine.match(/(\d{1,2}):(\d{2})[,:](\d{3})\s*-->\s*(\d{1,2}):(\d{2})[,:](\d{3})/);
        
        if (nonStandardMatch) {
          // Convert MM:SS:mmm to H:MM:SS.cc
          const startMM = nonStandardMatch[1].padStart(2, '0');
          const startSS = nonStandardMatch[2];
          const startMs = nonStandardMatch[3];
          const endMM = nonStandardMatch[4].padStart(2, '0');
          const endSS = nonStandardMatch[5];
          const endMs = nonStandardMatch[6];
          
          startTime = `0:${startMM}:${startSS}.${startMs.slice(0, 2)}`;
          endTime = `0:${endMM}:${endSS}.${endMs.slice(0, 2)}`;
          console.log('Converted non-standard timing:', timingLine, '->', startTime, endTime);
        } else {
          console.log('Failed to match timing:', timingLine);
          continue;
        }
      }

      // Get subtitle text
      const textLines = lines.slice(textStartIndex).filter(l => l.trim());
      const text = textLines.join('\\N');

      if (text) {
        events.push(`Dialogue: 0,${startTime},${endTime},Default,,0,0,0,,${text}`);
      }
    }

    console.log('ASS events generated:', events.length);
    const result = header + events.join('\n');
    console.log('ASS content preview:', result.slice(0, 500));
    
    return result;
  }

  async createVideo(
    imageFile: Blob,
    audioFile: File,
    srtContent: string,
    onProgress: (ratio: number) => void
  ): Promise<string> {
    if (!this.loaded) throw new Error("FFmpeg not loaded");

    // Normalize extensions
    const audioExt = audioFile.name.split('.').pop() || 'mp3';
    const audioName = `audio.${audioExt}`;
    const outputName = 'output.mp4';

    onProgress(0.01);

    // Parse subtitles
    const subtitles = this.parseSrtToSubtitles(srtContent);
    console.log('Parsed subtitles:', subtitles);

    // Get audio duration (approximate from file size, or use a reasonable max)
    // We'll generate frames for the full audio duration
    const audioDuration = await this.getAudioDuration(audioFile);
    console.log('Audio duration:', audioDuration, 'seconds');

    // Generate frames with burned-in subtitles using Canvas
    onProgress(0.05);
    const fps = 4; // 4 fps for better timing accuracy (0.25s precision)
    const totalFrames = Math.ceil(audioDuration * fps);
    
    console.log(`Generating ${totalFrames} frames at ${fps} fps...`);

    // Load the base image
    const baseImage = await this.loadImage(imageFile);
    
    // Cache for rendered frames - reuse if subtitle hasn't changed
    let lastSubtitle = '';
    let cachedFrameData: Uint8Array | null = null;
    
    // Generate each frame with the appropriate subtitle
    for (let i = 0; i < totalFrames; i++) {
      const currentTime = i / fps;
      const currentSubtitle = subtitles.find(
        sub => currentTime >= sub.startSec && currentTime < sub.endSec
      );
      
      const subtitleText = currentSubtitle?.text || '';
      
      // Only re-render if subtitle changed
      if (subtitleText !== lastSubtitle || !cachedFrameData) {
        cachedFrameData = await this.renderFrame(
          baseImage, 
          subtitleText,
          1280, 
          720
        );
        lastSubtitle = subtitleText;
      }
      
      const frameName = `frame${i.toString().padStart(5, '0')}.jpg`;
      // Create a copy of the cached data to avoid ArrayBuffer detachment
      await this.ffmpeg.writeFile(frameName, new Uint8Array(cachedFrameData));
      
      if (i % 20 === 0) {
        onProgress(0.05 + (i / totalFrames) * 0.4);
        console.log(`Generated frame ${i + 1}/${totalFrames}`);
      }
    }

    onProgress(0.45);

    // Write audio file
    await this.ffmpeg.writeFile(audioName, await fetchFile(audioFile));
    onProgress(0.50);

    // Set up progress tracking
    this.ffmpeg.on('progress', ({ progress }) => {
      onProgress(0.50 + progress * 0.45);
    });

    // Combine frames into video with audio
    console.log('Combining frames into video...');
    
    await this.ffmpeg.exec([
      '-framerate', fps.toString(),
      '-i', 'frame%05d.jpg',
      '-i', audioName,
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-pix_fmt', 'yuv420p',
      '-shortest',
      outputName
    ]);

    onProgress(0.95);

    // Read Output
    const data = await this.ffmpeg.readFile(outputName);

    // Cleanup
    try {
      // Delete all generated frames
      for (let i = 0; i < totalFrames; i++) {
        const frameName = `frame${i.toString().padStart(5, '0')}.jpg`;
        await this.ffmpeg.deleteFile(frameName);
      }
      await this.ffmpeg.deleteFile(audioName);
      await this.ffmpeg.deleteFile(outputName);
    } catch (e) {
      // Ignore cleanup errors
    }

    onProgress(1);

    const blob = new Blob([data], { type: 'video/mp4' });
    return URL.createObjectURL(blob);
  }
}

export const videoService = new VideoService();
