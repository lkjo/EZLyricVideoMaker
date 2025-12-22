import { GoogleGenAI } from "@google/genai";

let cachedApiKey: string | null = null;

export const setApiKey = (key: string) => {
  cachedApiKey = key;
  localStorage.setItem('gemini_api_key', key);
};

export const getApiKey = (): string | null => {
  if (cachedApiKey) return cachedApiKey;
  const stored = localStorage.getItem('gemini_api_key');
  if (stored) {
    cachedApiKey = stored;
    return stored;
  }
  return null;
};

export const clearApiKey = () => {
  cachedApiKey = null;
  localStorage.removeItem('gemini_api_key');
};

const getAiClient = () => {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error("Please enter your Gemini API Key first");
  }
  return new GoogleGenAI({ apiKey });
};

/**
 * Converts a File object to a Base64 string suitable for Gemini API
 */
const fileToGenerativePart = async (file: File): Promise<{ inlineData: { data: string; mimeType: string } }> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64String = (reader.result as string).split(',')[1];
      resolve({
        inlineData: {
          data: base64String,
          mimeType: file.type,
        },
      });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

/**
 * Generates SRT subtitles from an audio file using Gemini.
 */
export const generateSrtFromAudio = async (audioFile: File): Promise<string> => {
  const ai = getAiClient();
  const audioPart = await fileToGenerativePart(audioFile);

  const prompt = `
    Listen to this audio file carefully. 
    Your task is to transcribe the lyrics or spoken words into a strictly formatted SRT (SubRip Subtitle) file.
    
    LANGUAGE REQUIREMENT:
    - If the audio contains Chinese, transcribe using Traditional Chinese (繁體中文), NOT Simplified Chinese.
    - For other languages, transcribe in the original language.
    
    CRITICAL - SRT Format Requirements:
    - Each subtitle block must have: sequence number, timing line, and text
    - Timing format MUST be: HH:MM:SS,mmm --> HH:MM:SS,mmm
    - HH = hours (00-99), MM = minutes (00-59), SS = seconds (00-59), mmm = milliseconds (000-999)
    - Use comma (,) to separate seconds and milliseconds, NOT colon (:)
    
    Example of CORRECT format:
    1
    00:00:05,200 --> 00:00:08,500
    First line of lyrics
    
    2
    00:00:09,100 --> 00:00:12,800
    Second line of lyrics
    
    Rules:
    1. Output ONLY the SRT content. No markdown, no code blocks, no explanations.
    2. Timing must be as accurate as possible.
    3. Skip long instrumental breaks or mark as [Instrumental].
    4. Break lines naturally for readability.
  `;

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: {
      parts: [audioPart, { text: prompt }],
    },
  });

  const text = response.text;
  if (!text) {
    throw new Error("Failed to generate subtitles.");
  }

  // Cleanup potential markdown if the model disobeys slightly
  return text.replace(/```srt/g, '').replace(/```/g, '').trim();
};

/**
 * Generates a cover image based on the SRT context using Gemini.
 */
export const generateCoverImage = async (srtContent: string): Promise<{ data: string; mimeType: string }> => {
  const ai = getAiClient();

  const prompt = `
    Analyze the following subtitles/lyrics to understand the mood, theme, and imagery of the song:
    "${srtContent.slice(0, 1000)}..."
    
    Based on this analysis, generate a high-quality, artistic, square (1:1 aspect ratio) album cover art.
    Style: Cinematic, digital art, high resolution, evocative.
    Do not include text on the image.
  `;

  // Using gemini-2.5-flash-image for image generation as per guidelines for general image tasks
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash-image',
    contents: {
      parts: [{ text: prompt }],
    },
    config: {
        // No responseMimeType for this model
    }
  });

  // Extract image from response
  for (const part of response.candidates?.[0]?.content?.parts || []) {
    if (part.inlineData) {
        return {
            data: part.inlineData.data,
            mimeType: part.inlineData.mimeType || 'image/png'
        };
    }
  }

  throw new Error("No image generated.");
};