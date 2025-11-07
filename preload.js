const { contextBridge, ipcRenderer } = require('electron');
const os = require('os');
const path = require('path');

// Exponer API segura al renderer
contextBridge.exposeInMainWorld('electronAPI', {
  // Seleccionar archivos
  selectAudioFile: () => ipcRenderer.invoke('select-audio-file'),
  selectBgFile: () => ipcRenderer.invoke('select-bg-file'),

  // Generación de video
  saveFrame: (frameData, frameNumber, framesDir) =>
    ipcRenderer.invoke('save-frame', { frameData, frameNumber, framesDir }),

  generateVideo: (options) => ipcRenderer.invoke('generate-video', options),

  cleanupFrames: (framesDir) => ipcRenderer.invoke('cleanup-frames', framesDir),

  saveVideoDialog: () => ipcRenderer.invoke('save-video-dialog'),

  // Obtener path temporal
  getTempDir: () => os.tmpdir(),

  // Gestión de videos
  getVideos: () => ipcRenderer.invoke('get-videos'),
  createVideo: (videoData) => ipcRenderer.invoke('create-video', videoData),
  updateVideo: (id, updates) => ipcRenderer.invoke('update-video', id, updates),
  deleteVideo: (id) => ipcRenderer.invoke('delete-video', id),
  openVideoFolder: (videoPath) => ipcRenderer.invoke('open-video-folder', videoPath),
  openVideoFile: (videoPath) => ipcRenderer.invoke('open-video-file', videoPath),
  getOutputsDir: () => ipcRenderer.invoke('get-outputs-dir'),

  // Escuchar progreso de FFmpeg
  onFFmpegProgress: (callback) => {
    ipcRenderer.on('ffmpeg-progress', (event, percent) => callback(percent));
  },

  // Analizar audio con FFmpeg para detectar bajos
  analyzeAudioFFmpeg: (options) => ipcRenderer.invoke('analyze-audio-ffmpeg', options)
});
