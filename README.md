# 🎵 Gemini Lyric Video Maker

Transform your audio into a lyric video with AI-generated subtitles and cover art.

![Demo](https://img.shields.io/badge/Powered%20by-Gemini%20AI-blue)
![Platform](https://img.shields.io/badge/Platform-Windows-green)
![License](https://img.shields.io/badge/License-GPL--3.0-blue)

## ✨ Features

- **AI Transcription** - Automatically transcribe lyrics using Gemini 2.5 Flash
- **AI Cover Art** - Generate album cover art based on lyrics
- **Video Creation** - Burn subtitles directly onto video using FFmpeg.wasm
- **Traditional Chinese** - Automatically uses Traditional Chinese for Chinese audio
- **Offline Processing** - Video rendering happens in your browser

## 📥 Download

### Windows
Download the latest release from [Releases](../../releases):
- **Installer**: `Gemini Lyric Video Maker Setup x.x.x.exe`
- **Portable**: `Gemini-Lyric-Video-Maker-Portable.zip` (extract and run)

## 🚀 Usage

1. **Get API Key** - Visit [Google AI Studio](https://aistudio.google.com/apikey) to get your free Gemini API Key
2. **Enter API Key** - Paste your API key in the app
3. **Upload Audio** - Select an MP3 or WAV file (max 25MB)
4. **Review Subtitles** - Edit the AI-generated subtitles if needed
5. **Generate Art** - AI creates cover art based on lyrics
6. **Create Video** - Click to generate and download your lyric video

## 🛠️ Development

### Prerequisites
- Node.js 18+
- npm

### Setup
```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Run with Electron (development)
npm run electron:dev
```

### Build
```bash
# Build web version
npm run build

# Build Electron app (Windows)
npm run electron:build
```

## 📁 Project Structure

```
├── App.tsx                 # Main application component
├── components/             # UI components
├── services/
│   ├── geminiService.ts    # Gemini AI integration
│   └── ffmpegService.ts    # FFmpeg video processing
├── electron/
│   └── main.cjs            # Electron main process
└── release/                # Built applications (gitignored)
```

## ⚠️ Notes

- API Key is stored locally in your browser/app (never uploaded)
- Video processing happens entirely in your browser using FFmpeg.wasm
- Large audio files may take longer to process

## 📄 License

GPL-3.0-only — see `LICENSE`.

## 🙏 Credits

- [Gemini AI](https://ai.google.dev/) - AI transcription and image generation
- [FFmpeg.wasm](https://ffmpegwasm.netlify.app/) - Browser-based video processing
- [Electron](https://www.electronjs.org/) - Desktop application framework
