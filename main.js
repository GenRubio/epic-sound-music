const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;

ffmpeg.setFfmpegPath(ffmpegPath);

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1110,
    height: 700,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false, // Necesario para acceder a módulos de Node en preload
      preload: path.join(__dirname, 'preload.js')
    },
    backgroundColor: '#0b0f1a',
    icon: path.join(__dirname, 'icon.png')
  });

  mainWindow.loadFile('index.html');

  // Abrir DevTools en desarrollo
  mainWindow.webContents.openDevTools();
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Diálogo para seleccionar archivo de audio
ipcMain.handle('select-audio-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'Audio', extensions: ['mp3', 'wav', 'ogg', 'aac', 'm4a', 'flac'] }
    ]
  });

  if (result.canceled) return null;
  return result.filePaths[0];
});

// Diálogo para seleccionar imagen de fondo
ipcMain.handle('select-bg-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'Imagen', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp'] }
    ]
  });

  if (result.canceled) return null;
  return result.filePaths[0];
});

// Diálogo para seleccionar video de fondo
ipcMain.handle('select-bg-video', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'Video', extensions: ['mp4', 'webm', 'mov', 'avi', 'mkv'] }
    ]
  });

  if (result.canceled) return null;
  return result.filePaths[0];
});

// Generar video con FFmpeg
ipcMain.handle('generate-video', async (event, options) => {
  const { audioPath, framesDir, outputPath, fps, totalFrames } = options;

  return new Promise((resolve, reject) => {
    // Patrón para los frames: frame_0001.png, frame_0002.png, etc.
    const framePattern = path.join(framesDir, 'frame_%04d.png');

    const command = ffmpeg()
      .input(framePattern)
      .inputFPS(fps)
      .input(audioPath)
      .videoCodec('libx264')
      .outputOptions([
        '-preset', 'medium',         // Balance entre velocidad y calidad
        '-crf', '18',                // Calidad constante (0-51, menor = mejor)
        '-pix_fmt', 'yuv420p',       // Compatibilidad
        '-movflags', '+faststart',   // Streaming web
        '-threads', '0'              // Usar todos los núcleos disponibles
      ])
      .audioCodec('aac')
      .audioBitrate('320k')
      .output(outputPath)
      .on('start', (commandLine) => {
        console.log('FFmpeg iniciado:', commandLine);
      })
      .on('progress', (progress) => {
        // Enviar progreso al renderer
        if (progress.frames) {
          const percent = Math.min(100, (progress.frames / totalFrames) * 100);
          event.sender.send('ffmpeg-progress', percent);
        }
      })
      .on('end', () => {
        console.log('Video generado exitosamente');
        resolve(outputPath);
      })
      .on('error', (err) => {
        console.error('Error en FFmpeg:', err);
        reject(err);
      });

    command.run();
  });
});

// Guardar frame como PNG
ipcMain.handle('save-frame', async (event, { frameData, frameNumber, framesDir }) => {
  // Crear directorio si no existe
  if (!fs.existsSync(framesDir)) {
    fs.mkdirSync(framesDir, { recursive: true });
  }

  // frameData viene como base64
  const base64Data = frameData.replace(/^data:image\/png;base64,/, '');
  const buffer = Buffer.from(base64Data, 'base64');

  const framePath = path.join(framesDir, `frame_${String(frameNumber).padStart(4, '0')}.png`);

  return new Promise((resolve, reject) => {
    fs.writeFile(framePath, buffer, (err) => {
      if (err) reject(err);
      else resolve(framePath);
    });
  });
});

// Limpiar frames temporales
ipcMain.handle('cleanup-frames', async (event, framesDir) => {
  if (fs.existsSync(framesDir)) {
    const files = fs.readdirSync(framesDir);
    for (const file of files) {
      if (file.startsWith('frame_') && file.endsWith('.png')) {
        fs.unlinkSync(path.join(framesDir, file));
      }
    }
  }
  return true;
});

// Diálogo para guardar video
ipcMain.handle('save-video-dialog', async () => {
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: 'visualizer.mp4',
    filters: [
      { name: 'Video MP4', extensions: ['mp4'] }
    ]
  });

  if (result.canceled) return null;
  return result.filePath;
});

// ========== GESTIÓN DE BASE DE DATOS DE VIDEOS ==========

const dbPath = path.join(__dirname, 'videos.json');
const settingsPath = path.join(__dirname, 'settings.json');
const outputsDir = path.join(__dirname, 'outputs');

// Crear directorio de outputs si no existe
if (!fs.existsSync(outputsDir)) {
  fs.mkdirSync(outputsDir, { recursive: true });
}

// Cargar base de datos
function loadDB() {
  if (!fs.existsSync(dbPath)) {
    fs.writeFileSync(dbPath, JSON.stringify({ videos: [] }, null, 2));
  }
  return JSON.parse(fs.readFileSync(dbPath, 'utf-8'));
}

// Guardar base de datos
function saveDB(data) {
  fs.writeFileSync(dbPath, JSON.stringify(data, null, 2));
}

// Obtener todos los videos
ipcMain.handle('get-videos', async () => {
  const db = loadDB();

  // Resetear videos en estado 'generating' a 'pending'
  let hasChanges = false;
  db.videos = db.videos.map(video => {
    if (video.status === 'generating') {
      hasChanges = true;
      return { ...video, status: 'pending' };
    }
    return video;
  });

  // Guardar cambios si hubo videos reseteados
  if (hasChanges) {
    saveDB(db);
  }

  return db.videos;
});

// Crear nuevo video
ipcMain.handle('create-video', async (event, videoData) => {
  const db = loadDB();
  const newVideo = {
    id: Date.now().toString(),
    title: videoData.title,
    audioPath: videoData.audioPath,
    bgPath: videoData.bgPath || null,
    bgVideoPath: videoData.bgVideoPath || null,
    logoPath: videoData.logoPath || null,
    color: videoData.color,
    text: videoData.text,
    sunoLyrics: videoData.sunoLyrics || '',
    sunoStyles: videoData.sunoStyles || '',
    youtubeTitle: videoData.youtubeTitle || null,
    youtubeDescription: videoData.youtubeDescription || null,
    youtubeTags: videoData.youtubeTags || null,
    status: 'pending', // pending, generating, completed, error
    createdAt: new Date().toISOString(),
    outputPath: null,
    error: null
  };
  db.videos.unshift(newVideo);
  saveDB(db);
  return newVideo;
});

// Actualizar video
ipcMain.handle('update-video', async (event, id, updates) => {
  const db = loadDB();
  const index = db.videos.findIndex(v => v.id === id);
  if (index !== -1) {
    db.videos[index] = { ...db.videos[index], ...updates };
    saveDB(db);
    return db.videos[index];
  }
  return null;
});

// Eliminar video
ipcMain.handle('delete-video', async (event, id) => {
  const db = loadDB();
  const video = db.videos.find(v => v.id === id);

  // Eliminar archivo de video si existe
  if (video && video.outputPath && fs.existsSync(video.outputPath)) {
    fs.unlinkSync(video.outputPath);
  }

  db.videos = db.videos.filter(v => v.id !== id);
  saveDB(db);
  return true;
});

// Abrir carpeta del video
ipcMain.handle('open-video-folder', async (event, videoPath) => {
  const { shell } = require('electron');
  shell.showItemInInFolder(videoPath);
});

// Abrir archivo de video
ipcMain.handle('open-video-file', async (event, videoPath) => {
  const { shell } = require('electron');
  await shell.openPath(videoPath);
});

// Obtener path de outputs
ipcMain.handle('get-outputs-dir', () => {
  return outputsDir;
});

// ========== GESTIÓN DE SETTINGS ==========

// Cargar settings
function loadSettings() {
  if (!fs.existsSync(settingsPath)) {
    const defaultSettings = { geminiApiKey: '' };
    fs.writeFileSync(settingsPath, JSON.stringify(defaultSettings, null, 2));
    return defaultSettings;
  }
  return JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
}

// Guardar settings
function saveSettings(settings) {
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
}

// Obtener settings
ipcMain.handle('get-settings', async () => {
  return loadSettings();
});

// Guardar settings
ipcMain.handle('save-settings', async (event, settings) => {
  saveSettings(settings);
  return true;
});

// Generar metadatos de YouTube con Gemini
ipcMain.handle('generate-youtube-metadata', async (event, { sunoLyrics, sunoStyles }) => {
  const settings = loadSettings();
  const apiKey = settings.geminiApiKey;

  if (!apiKey) {
    throw new Error('Gemini API key not configured. Please add it in Settings.');
  }

  try {
    const prompt = `You are an expert in YouTube SEO and music marketing. Based on the following song information, generate optimized metadata for a YouTube music video.

Song Lyrics:
${sunoLyrics}

Music Styles: ${sunoStyles}

Please generate:
1. A catchy, SEO-optimized title (max 100 characters)
2. A compelling description (2-3 paragraphs) that includes relevant keywords
3. A list of relevant tags (comma-separated, at least 10-15 tags)

Format your response EXACTLY as a JSON object like this:
{
  "title": "Your title here",
  "description": "Your description here",
  "tags": "tag1, tag2, tag3, ..."
}

Important:
- Everything must be in English
- Focus on music genre, mood, and themes from the lyrics
- Make it SEO-friendly for YouTube search
- The title should be engaging and clickable
- Include relevant hashtags in the description
- Tags should cover genre, mood, instruments, similar artists, and themes`;

    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=' + apiKey, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: prompt
          }]
        }],
        generationConfig: {
          temperature: 0.9,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 2048,
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    const generatedText = data.candidates[0].content.parts[0].text;

    // Extraer JSON de la respuesta
    const jsonMatch = generatedText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Failed to parse Gemini response');
    }

    const metadata = JSON.parse(jsonMatch[0]);
    return metadata;
  } catch (error) {
    console.error('Error generating YouTube metadata:', error);
    throw error;
  }
});

// ========== ANÁLISIS DE AUDIO CON FFMPEG ==========
ipcMain.handle('analyze-audio-ffmpeg', async (event, options) => {
  const { audioPath, totalFrames, fps } = options;

  return new Promise((resolve, reject) => {
    console.log('[analyze-audio-ffmpeg] Extrayendo PCM data...');

    const pcmData = [];

    // Extraer audio como PCM 16-bit mono a 44100Hz
    const command = ffmpeg(audioPath)
      .audioCodec('pcm_s16le')
      .audioChannels(1)
      .audioFrequency(44100)
      .format('s16le')
      .on('start', (cmdLine) => {
        console.log('[analyze-audio-ffmpeg] FFmpeg command:', cmdLine);
      })
      .on('error', (err) => {
        console.error('[analyze-audio-ffmpeg] Error:', err);
        reject(err);
      })
      .on('end', () => {
        console.log('[analyze-audio-ffmpeg] Extracción completada, procesando datos...');

        // Convertir buffer a array de samples
        const samples = new Int16Array(Buffer.concat(pcmData).buffer);
        const sampleRate = 44100;
        const bassLevels = [];

        // Analizar bajos para cada frame
        for (let frame = 0; frame < totalFrames; frame++) {
          const time = frame / fps;
          const sampleIndex = Math.floor(time * sampleRate);
          const windowSize = 2048; // ~46ms a 44.1kHz

          let sum = 0;
          let count = 0;

          // Extraer ventana de samples
          for (let i = 0; i < windowSize && sampleIndex + i < samples.length; i++) {
            // Normalizar de Int16 (-32768 a 32767) a 0-1
            const normalized = Math.abs(samples[sampleIndex + i]) / 32768;
            sum += normalized;
            count++;
          }

          if (count > 0) {
            const avg = sum / count;
            // Aplicar curva exponencial para enfatizar cambios
            const level = Math.pow(Math.min(avg * 2, 1), 1.2);
            bassLevels.push(level);
          } else {
            bassLevels.push(0);
          }

          // Log progreso cada 1000 frames
          if (frame % 1000 === 0) {
            const percent = ((frame / totalFrames) * 100).toFixed(1);
            console.log(`[analyze-audio-ffmpeg] Progreso: ${frame}/${totalFrames} (${percent}%)`);
          }
        }

        console.log('[analyze-audio-ffmpeg] Análisis completado, bassLevels:', bassLevels.length);
        resolve(bassLevels);
      });

    // Pipe stdout a un buffer
    const stream = command.pipe();

    stream.on('data', (chunk) => {
      pcmData.push(chunk);
    });

    stream.on('error', (err) => {
      console.error('[analyze-audio-ffmpeg] Stream error:', err);
      reject(err);
    });
  });
});
