export enum AppStep {
  UPLOAD = 0,
  TRANSCRIBING = 1,
  EDIT_SRT = 2,
  GENERATING_IMAGE = 3,
  PREVIEW_DOWNLOAD = 4,
}

export interface VideoData {
  audioFile: File | null;
  srtContent: string;
  imageBase64: string | null;
  imageMimeType: string | null;
  generatedVideoUrl: string | null;
}

export interface FfmpegLog {
  type: string;
  message: string;
}