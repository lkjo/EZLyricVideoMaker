import React, { useState, useRef, useEffect } from 'react';
import { AppStep, VideoData } from './types';
import { StepIndicator } from './components/StepIndicator';
import { Button } from './components/Button';
import { generateSrtFromAudio, generateCoverImage, setApiKey, getApiKey, clearApiKey } from './services/geminiService';
import { videoService } from './services/ffmpegService';

export default function App() {
  const [step, setStep] = useState<AppStep>(AppStep.UPLOAD);
  const [data, setData] = useState<VideoData>({
    audioFile: null,
    srtContent: '',
    imageBase64: null,
    imageMimeType: null,
    generatedVideoUrl: null,
  });
  
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ffmpegLogs, setFfmpegLogs] = useState<string>('');
  const [progress, setProgress] = useState(0);
  
  // API Key state
  const [apiKey, setApiKeyState] = useState<string>('');
  const [hasApiKey, setHasApiKey] = useState(false);

  // Check for stored API Key on load
  useEffect(() => {
    const storedKey = getApiKey();
    if (storedKey) {
      setApiKeyState(storedKey);
      setHasApiKey(true);
    }
  }, []);

  const handleSaveApiKey = () => {
    if (apiKey.trim()) {
      setApiKey(apiKey.trim());
      setHasApiKey(true);
      setError(null);
    } else {
      setError('Please enter a valid API Key');
    }
  };

  const handleClearApiKey = () => {
    clearApiKey();
    setApiKeyState('');
    setHasApiKey(false);
  };

  // Reset all data and start fresh
  const resetAndStartOver = () => {
    // Revoke old video URL to free memory
    if (data.generatedVideoUrl) {
      URL.revokeObjectURL(data.generatedVideoUrl);
    }
    // Reset all data
    setData({
      audioFile: null,
      srtContent: '',
      imageBase64: null,
      imageMimeType: null,
      generatedVideoUrl: null,
    });
    setError(null);
    setFfmpegLogs('');
    setProgress(0);
    setStep(AppStep.UPLOAD);
  };

  // -- Step 1: Upload --
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 25 * 1024 * 1024) { // 25MB limit suggestion
        setError("File too large. Please select a file under 25MB.");
        return;
      }
      setData(prev => ({ ...prev, audioFile: file }));
      setError(null);
      
      // Auto-start transcription
      setStep(AppStep.TRANSCRIBING);
      await processTranscription(file);
    }
  };

  // -- Step 2: Transcription --
  const processTranscription = async (file: File) => {
    setIsProcessing(true);
    try {
      const srt = await generateSrtFromAudio(file);
      setData(prev => ({ ...prev, srtContent: srt }));
      setStep(AppStep.EDIT_SRT);
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Transcription failed. Please try again.");
      setStep(AppStep.UPLOAD);
    } finally {
      setIsProcessing(false);
    }
  };

  // -- Step 3: Edit SRT --
  const handleSrtChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setData(prev => ({ ...prev, srtContent: e.target.value }));
  };

  const confirmSrt = async () => {
    setStep(AppStep.GENERATING_IMAGE);
    await processImageGeneration();
  };

  // -- Step 4: Generate Image --
  const processImageGeneration = async () => {
    setIsProcessing(true);
    setError(null);
    try {
      const imageResult = await generateCoverImage(data.srtContent);
      setData(prev => ({ 
        ...prev, 
        imageBase64: imageResult.data,
        imageMimeType: imageResult.mimeType
      }));
      setStep(AppStep.PREVIEW_DOWNLOAD);
    } catch (err: any) {
      setError(err.message || "Image generation failed.");
      // Allow retry or fallback? 
      // For now, let user try again or go back
      setStep(AppStep.EDIT_SRT);
    } finally {
      setIsProcessing(false);
    }
  };

  // -- Step 5: Video Generation (FFmpeg) --
  const generateVideo = async () => {
    if (!data.audioFile || !data.imageBase64 || !data.srtContent) return;

    setIsProcessing(true);
    setProgress(0);
    setFfmpegLogs("Initializing Video Engine...");
    
    try {
      // 1. Load FFmpeg
      await videoService.load((msg) => {
        // Keep logs short
        setFfmpegLogs(prev => msg); 
      });

      setFfmpegLogs("Engine Loaded. preparing assets...");

      // 2. Convert Base64 image to Blob
      const byteCharacters = atob(data.imageBase64);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const imageBlob = new Blob([byteArray], { type: data.imageMimeType || 'image/png' });

      // 3. Process
      setFfmpegLogs("Rendering Video... (This may take a moment)");
      const videoUrl = await videoService.createVideo(
        imageBlob, 
        data.audioFile, 
        data.srtContent,
        (ratio) => setProgress(Math.round(ratio * 100))
      );

      setData(prev => ({ ...prev, generatedVideoUrl: videoUrl }));
      setFfmpegLogs("Done!");

    } catch (err: any) {
      console.error(err);
      setError("Video generation failed: " + err.message);
      // Fallback: allow downloading the components separately if video fails
    } finally {
      setIsProcessing(false);
    }
  };

  // -- Render Helpers --
  
  // Download Helpers
  const downloadSrt = () => {
    const element = document.createElement("a");
    const file = new Blob([data.srtContent], {type: 'text/plain'});
    element.href = URL.createObjectURL(file);
    element.download = `${data.audioFile?.name.split('.')[0] || 'subtitles'}.srt`;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  const downloadImage = () => {
    if(!data.imageBase64) return;
    const link = document.createElement('a');
    link.href = `data:${data.imageMimeType};base64,${data.imageBase64}`;
    link.download = 'cover_art.png';
    link.click();
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col items-center p-4 md:p-8">
      
      {/* Header */}
      <header className="mb-12 text-center max-w-2xl">
        <h1 className="text-4xl md:text-5xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 via-purple-500 to-pink-500 mb-4 tracking-tight">
          Gemini Lyric Maker
        </h1>
        <p className="text-zinc-400 text-lg">
          Transform your audio into a music video with AI-generated subtitles and art.
        </p>
      </header>

      <StepIndicator currentStep={step} />

      {/* Main Content Area */}
      <main className="w-full max-w-3xl bg-zinc-900/50 backdrop-blur-sm border border-zinc-800 rounded-2xl p-6 md:p-10 shadow-2xl">
        
        {error && (
          <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 flex items-center justify-between">
            <span>{error}</span>
            <button onClick={() => setError(null)} className="text-sm hover:underline">Dismiss</button>
          </div>
        )}

        {/* Step 1: Upload */}
        {step === AppStep.UPLOAD && (
          <div className="space-y-6">
            {/* API Key Settings */}
            <div className="p-4 bg-zinc-800/50 rounded-xl border border-zinc-700">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <svg className="w-5 h-5 text-yellow-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                  </svg>
                  <h4 className="text-sm font-medium text-zinc-300">Gemini API Key</h4>
                </div>
                {hasApiKey && (
                  <span className="text-xs text-green-400 flex items-center gap-1">
                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                    Configured
                  </span>
                )}
              </div>
              
              {!hasApiKey ? (
                <div className="space-y-3">
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKeyState(e.target.value)}
                    placeholder="Enter your Gemini API Key..."
                    className="w-full px-4 py-2.5 bg-zinc-900 border border-zinc-600 rounded-lg text-zinc-200 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                    onKeyDown={(e) => e.key === 'Enter' && handleSaveApiKey()}
                  />
                  <div className="flex items-center justify-between">
                    <a 
                      href="https://aistudio.google.com/apikey" 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                      Get API Key
                    </a>
                    <Button onClick={handleSaveApiKey} className="!py-2 !px-4 text-sm">
                      Save
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-zinc-500 font-mono">
                    {apiKey.slice(0, 8)}...{apiKey.slice(-4)}
                  </span>
                  <button 
                    onClick={handleClearApiKey}
                    className="text-xs text-red-400 hover:text-red-300"
                  >
                      Clear
                  </button>
                </div>
              )}
            </div>

            {/* Upload Area */}
            <div className={`text-center py-12 border-2 border-dashed rounded-xl transition-all group relative overflow-hidden ${
              hasApiKey 
                ? 'border-zinc-700 hover:border-blue-500/50 hover:bg-zinc-800/30 cursor-pointer' 
                : 'border-zinc-800 bg-zinc-900/50 opacity-60 cursor-not-allowed'
            }`}>
              <input 
                type="file" 
                accept="audio/mp3,audio/wav,audio/mpeg"
                onChange={handleFileUpload}
                disabled={!hasApiKey}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10 disabled:cursor-not-allowed"
              />
              <div className="flex flex-col items-center gap-4">
                <div className={`w-16 h-16 rounded-full bg-zinc-800 flex items-center justify-center transition-transform ${hasApiKey ? 'group-hover:scale-110' : ''}`}>
                  <svg className={`w-8 h-8 ${hasApiKey ? 'text-blue-400' : 'text-zinc-600'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                  </svg>
                </div>
                <div>
                  <h3 className={`text-xl font-semibold mb-1 ${hasApiKey ? 'text-white' : 'text-zinc-500'}`}>
                    {hasApiKey ? 'Upload Song' : 'Set API Key First'}
                  </h3>
                  <p className="text-zinc-500">MP3 or WAV files, max 25MB</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Step 2: Processing Transcription */}
        {step === AppStep.TRANSCRIBING && (
          <div className="text-center py-16 flex flex-col items-center gap-6">
            <div className="relative w-24 h-24">
              <div className="absolute inset-0 rounded-full border-4 border-zinc-800"></div>
              <div className="absolute inset-0 rounded-full border-4 border-t-blue-500 animate-spin"></div>
              <div className="absolute inset-0 flex items-center justify-center">
                <svg className="w-8 h-8 text-blue-500 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                   <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                </svg>
              </div>
            </div>
            <div>
              <h3 className="text-2xl font-bold text-white mb-2">Listening...</h3>
              <p className="text-zinc-400">Gemini is transcribing lyrics and timing.</p>
            </div>
          </div>
        )}

        {/* Step 3: Edit SRT */}
        {step === AppStep.EDIT_SRT && (
          <div className="flex flex-col h-full">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-semibold text-white">Review Subtitles</h3>
              <span className="text-xs text-zinc-500 bg-zinc-800 px-2 py-1 rounded">SRT Format</span>
            </div>
            <textarea
              value={data.srtContent}
              onChange={handleSrtChange}
              className="w-full h-80 bg-zinc-950 border border-zinc-700 rounded-lg p-4 font-mono text-sm text-zinc-300 focus:ring-2 focus:ring-blue-500 focus:outline-none mb-6 resize-none"
              placeholder="1
00:00:01,000 --> 00:00:04,000
Lyrics will appear here..."
            />
            <div className="flex justify-end gap-3">
               <Button variant="secondary" onClick={resetAndStartOver}>Start Over</Button>
               <Button onClick={confirmSrt}>Generate Art &rarr;</Button>
            </div>
          </div>
        )}

        {/* Step 4: Generating Image */}
        {step === AppStep.GENERATING_IMAGE && (
          <div className="text-center py-16 flex flex-col items-center gap-6">
            <div className="relative w-24 h-24">
              <div className="absolute inset-0 rounded-full border-4 border-zinc-800"></div>
              <div className="absolute inset-0 rounded-full border-4 border-t-purple-500 animate-spin"></div>
              <div className="absolute inset-0 flex items-center justify-center">
                <svg className="w-8 h-8 text-purple-500 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </div>
            </div>
            <div>
              <h3 className="text-2xl font-bold text-white mb-2">Imagining...</h3>
              <p className="text-zinc-400">Creating cover art based on your lyrics.</p>
            </div>
          </div>
        )}

        {/* Step 5: Preview & Download */}
        {step === AppStep.PREVIEW_DOWNLOAD && (
          <div className="flex flex-col gap-8">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
               {/* Cover Art Preview */}
               <div className="flex flex-col gap-2">
                 <h4 className="text-sm font-medium text-zinc-400">Generated Cover Art</h4>
                 <div className="aspect-square w-full rounded-xl overflow-hidden border border-zinc-700 relative group">
                    {data.imageBase64 && (
                      <img 
                        src={`data:${data.imageMimeType};base64,${data.imageBase64}`} 
                        alt="Generated Art" 
                        className="w-full h-full object-cover"
                      />
                    )}
                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <button onClick={downloadImage} className="text-white bg-black/50 p-2 rounded-full backdrop-blur hover:bg-white/20 transition-colors">
                          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
                        </button>
                    </div>
                 </div>
               </div>

               {/* Video Action Area */}
               <div className="flex flex-col justify-between gap-4">
                 <div>
                    <h4 className="text-sm font-medium text-zinc-400 mb-2">Subtitles</h4>
                    <div className="p-4 bg-zinc-950 rounded-xl border border-zinc-800 h-48 overflow-y-auto text-xs font-mono text-zinc-500">
                        <pre className="whitespace-pre-wrap">{data.srtContent}</pre>
                    </div>
                    <button onClick={downloadSrt} className="mt-2 text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1">
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
                        Download .srt file
                    </button>
                 </div>
                 
                 <div className="pt-4 border-t border-zinc-800">
                    {!data.generatedVideoUrl ? (
                      <div className="flex flex-col gap-3">
                        {!isProcessing ? (
                          <>
                            <Button 
                              onClick={generateVideo} 
                              className="w-full"
                            >
                              🎬 Create MP4 Video
                            </Button>
                            <p className="text-xs text-zinc-500 text-center">
                              Uses browser processing, may take a moment
                            </p>
                          </>
                        ) : (
                          <div className="p-4 bg-zinc-800/50 rounded-xl border border-zinc-700 space-y-4">
                            {/* Title and percentage */}
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <div className="w-3 h-3 bg-blue-500 rounded-full animate-pulse"></div>
                                <span className="text-sm font-medium text-zinc-200">Generating Video...</span>
                              </div>
                              <span className="text-2xl font-bold text-blue-400">{progress}%</span>
                            </div>
                            
                            {/* Progress bar */}
                            <div className="relative">
                              <div className="h-3 w-full bg-zinc-900 rounded-full overflow-hidden">
                                <div 
                                  className="h-full bg-gradient-to-r from-blue-600 to-purple-500 rounded-full transition-all duration-300 ease-out"
                                  style={{width: `${progress}%`}}
                                ></div>
                              </div>
                            </div>
                            
                            {/* Status message */}
                            <div className="flex items-center justify-center gap-2 text-xs text-zinc-400 bg-zinc-900/50 rounded-lg py-2 px-3">
                              <svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                              </svg>
                              <span className="font-mono truncate">{ffmpegLogs || 'Preparing...'}</span>
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="flex flex-col gap-3 animate-fade-in">
                        <div className="p-3 bg-green-500/10 border border-green-500/20 rounded-lg text-green-400 text-sm text-center">
                            Video Ready!
                        </div>
                        <a 
                          href={data.generatedVideoUrl} 
                          download="lyric_video.mp4"
                          className="w-full"
                        >
                          <Button className="w-full" variant="primary">
                            Download Video
                            <svg className="w-4 h-4 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
                          </Button>
                        </a>
                         <Button onClick={resetAndStartOver} variant="secondary" className="w-full">
                            Make Another
                         </Button>
                      </div>
                    )}
                 </div>
               </div>
            </div>
          </div>
        )}
      </main>

      <footer className="mt-12 text-zinc-600 text-sm">
         Powered by Gemini Flash 2.5 & FFmpeg.wasm
      </footer>
    </div>
  );
}