const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const zlib = require('zlib');
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
    backgroundColor: '#0b0f1a'
  });

  mainWindow.loadFile('index.html');

  // Abrir DevTools en desarrollo
  // mainWindow.webContents.openDevTools();
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
  const { audioPath, framesDir, outputPath, fps, totalFrames, trimStart, trimEnd } = options;

  return new Promise((resolve, reject) => {
    // Patrón para los frames: frame_0001.png, frame_0002.png, etc.
    const framePattern = path.join(framesDir, 'frame_%04d.png');

    const command = ffmpeg()
      .input(framePattern)
      .inputFPS(fps);

    // Configurar audio con trim si está especificado
    if (trimStart !== undefined && trimEnd !== undefined) {
      console.log(`[generate-video] Aplicando trim al audio: ${trimStart}s - ${trimEnd}s`);
      command
        .input(audioPath)
        .inputOptions([
          '-ss', trimStart.toString(),
          '-to', trimEnd.toString()
        ]);
    } else {
      command.input(audioPath);
    }

    command
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
    bgMobilePath: videoData.bgMobilePath || null,
    bgMobileVideoPath: videoData.bgMobileVideoPath || null,
    logoPath: videoData.logoPath || null,
    color: videoData.color,
    text: videoData.text,
    sunoLyrics: videoData.sunoLyrics || '',
    sunoStyles: videoData.sunoStyles || '',
    youtubeTitle: videoData.youtubeTitle || null,
    youtubeDescription: videoData.youtubeDescription || null,
    youtubeTags: videoData.youtubeTags || null,
    trimStart: videoData.trimStart || 0,
    trimEnd: videoData.trimEnd || 0,
    status: 'pending', // pending, generating, completed, error
    createdAt: new Date().toISOString(),
    outputPath: null,
    outputPathMobile: null,
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
  shell.showItemInFolder(videoPath);
});

// Abrir archivo de video
ipcMain.handle('open-video-file', async (event, videoPath) => {
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
    const defaultSettings = { geminiApiKey: '', defaultLogoPath: null };
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

// ========== EXTRACCIÓN DE DATOS DE SUNO ==========
ipcMain.handle('get-suno-data', async (event, sunoUrl) => {
  try {
    console.log('[get-suno-data] Fetching URL:', sunoUrl);

    // Obtener el HTML de la página (esto también maneja redirecciones)
    const { html, finalUrl } = await fetchUrlWithRedirect(sunoUrl);

    // Extraer el ID de la canción - primero de la URL final
    let songId = null;

    // Intentar extraer del finalUrl primero
    console.log('[get-suno-data] Final URL:', finalUrl);
    const urlIdMatch = finalUrl.match(/\/song\/([a-f0-9-]+)/i);
    if (urlIdMatch) {
      songId = urlIdMatch[1];
      console.log('[get-suno-data] Song ID from URL:', songId);
    }

    // Si no se encontró en URL, buscar en el HTML
    if (!songId) {
      console.log('[get-suno-data] Could not extract song ID from URL, trying HTML...');
      const canonicalMatch = html.match(/<link rel="canonical" href="https:\/\/suno\.com\/song\/([a-f0-9-]+)/i);
      if (canonicalMatch) {
        songId = canonicalMatch[1];
      } else {
        // Buscar en meta tags
        const ogUrlMatch = html.match(/<meta property="og:url" content="https:\/\/suno\.com\/song\/([a-f0-9-]+)/i);
        if (ogUrlMatch) {
          songId = ogUrlMatch[1];
        } else {
          // Buscar en el HTML completo por cualquier mención del ID
          const htmlIdMatch = html.match(/\/song\/([a-f0-9-]{36})/i);
          if (htmlIdMatch) {
            songId = htmlIdMatch[1];
          }
        }
      }
    }

    if (!songId) {
      throw new Error('No se pudo extraer el ID de la canción. Verifica que la URL sea correcta.');
    }

    console.log('[get-suno-data] Song ID:', songId);

    // Extraer datos de los scripts self.__next_f.push() (Next.js App Router)
    let title = 'Unknown';
    let lyrics = '';
    let styles = '';

    try {
      // Buscar todos los scripts que contienen self.__next_f.push
      const nextFScripts = html.match(/<script>self\.__next_f\.push\(\[1,"([^"]+)"\]\)<\/script>/g);

      if (nextFScripts) {
        console.log('[get-suno-data] Found', nextFScripts.length, 'self.__next_f.push scripts');

        // Combinar todo el contenido
        let combinedData = '';
        nextFScripts.forEach(script => {
          const match = script.match(/self\.__next_f\.push\(\[1,"([^"]+)"\]\)/);
          if (match && match[1]) {
            // Decodificar escapes
            let decoded = match[1]
              .replace(/\\"/g, '"')
              .replace(/\\n/g, '\n')
              .replace(/\\t/g, '\t')
              .replace(/\\\\/g, '\\');
            combinedData += decoded + ' ';
          }
        });

        console.log('[get-suno-data] Combined data length:', combinedData.length);

        // Extraer título del meta tag
        const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/);
        if (titleMatch) {
          title = titleMatch[1].replace(' | Suno', '').trim();
          console.log('[get-suno-data] Title extracted:', title);
        }

        // Buscar lyrics en el texto combinado - buscar patrones de verso/coro
        const lyricsPatterns = [
          /\(Verse \d+\)[^\(]*(?:\((?:Chorus|Pre-Chorus|Bridge|Outro)[^\(]*\))*/gi,
          /\[Verse \d+\][^\[]*(?:\[(?:Chorus|Pre-Chorus|Bridge|Outro)[^\[]*\])*/gi
        ];

        for (const pattern of lyricsPatterns) {
          const matches = combinedData.match(pattern);
          if (matches && matches.length > 0) {
            lyrics = matches.join('\n\n').trim();
            // Limpiar caracteres especiales de codificación
            lyrics = lyrics.replace(/Ô[ÇÉ][ÖÜ]/g, "'");
            console.log('[get-suno-data] Lyrics extracted, length:', lyrics.length);
            break;
          }
        }

        // Buscar styles/tags - buscar después de "tags" o "gn_tags"
        const stylePatterns = [
          /"tags":"([^"]+)"/,
          /"gn_tags":"([^"]+)"/,
          /"metadata_tags":"([^"]+)"/
        ];

        for (const pattern of stylePatterns) {
          const match = combinedData.match(pattern);
          if (match && match[1]) {
            styles = match[1];
            console.log('[get-suno-data] Styles extracted:', styles);
            break;
          }
        }

        // Si no encontramos lyrics con los patrones, buscar texto largo que parezca letra
        if (!lyrics) {
          // Buscar bloques de texto con saltos de línea que parezcan letras
          const textBlocks = combinedData.match(/[A-Z][^\n]{20,}(?:\n[^\n]{20,}){3,}/g);
          if (textBlocks && textBlocks.length > 0) {
            lyrics = textBlocks[0].trim().substring(0, 2000);
            console.log('[get-suno-data] Lyrics extracted from text block, length:', lyrics.length);
          }
        }

      } else {
        console.log('[get-suno-data] No self.__next_f.push scripts found');
      }

    } catch (e) {
      console.log('[get-suno-data] Error extracting data:', e.message);
    }

    console.log('[get-suno-data] Data extracted:', {
      title,
      hasLyrics: !!lyrics,
      hasStyles: !!styles
    });

    // Retornar solo lyrics y styles - el usuario descargará el MP3 manualmente
    return {
      title,
      lyrics,
      styles
    };
  } catch (error) {
    console.error('[get-suno-data] Error:', error);
    throw new Error(`Error extrayendo datos de Suno: ${error.message}`);
  }
});

// Función auxiliar para hacer fetch de una URL y retornar también la URL final
function fetchUrlWithRedirect(url, baseUrl = null, finalUrl = null) {
  return new Promise((resolve, reject) => {
    // Si la URL es relativa, construir URL completa
    let fullUrl = url;
    if (url.startsWith('/')) {
      if (!baseUrl) {
        baseUrl = 'https://suno.com';
      }
      fullUrl = baseUrl + url;
      console.log('[fetchUrlWithRedirect] Converting relative URL to:', fullUrl);
    }

    // Track final URL
    if (!finalUrl) {
      finalUrl = fullUrl;
    }

    const urlModule = fullUrl.startsWith('https:') ? https : require('http');

    urlModule.get(fullUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1'
      }
    }, (res) => {
      // Manejar todas las redirecciones (301, 302, 303, 307, 308)
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        console.log(`[fetchUrlWithRedirect] Redirect ${res.statusCode} to:`, res.headers.location);

        // Extraer base URL para redirecciones relativas
        const urlParts = fullUrl.match(/^(https?:\/\/[^\/]+)/);
        const newBaseUrl = urlParts ? urlParts[1] : 'https://suno.com';

        // Construir nueva URL final
        const newFinalUrl = res.headers.location.startsWith('http')
          ? res.headers.location
          : newBaseUrl + res.headers.location;

        return fetchUrlWithRedirect(res.headers.location, newBaseUrl, newFinalUrl).then(resolve).catch(reject);
      }

      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
        return;
      }

      // Manejar descompresión GZIP/deflate
      let stream = res;
      const encoding = res.headers['content-encoding'];

      if (encoding === 'gzip') {
        stream = res.pipe(zlib.createGunzip());
      } else if (encoding === 'deflate') {
        stream = res.pipe(zlib.createInflate());
      } else if (encoding === 'br') {
        stream = res.pipe(zlib.createBrotliDecompress());
      }

      let data = '';
      stream.setEncoding('utf8');

      stream.on('data', (chunk) => {
        data += chunk;
      });

      stream.on('end', () => {
        resolve({ html: data, finalUrl });
      });

      stream.on('error', (err) => {
        reject(err);
      });
    }).on('error', (err) => {
      reject(err);
    });
  });
}

// Función auxiliar para hacer fetch de una URL (backward compatibility)
function fetchUrl(url, baseUrl = null) {
  return new Promise((resolve, reject) => {
    // Si la URL es relativa, construir URL completa
    let fullUrl = url;
    if (url.startsWith('/')) {
      if (!baseUrl) {
        baseUrl = 'https://suno.com';
      }
      fullUrl = baseUrl + url;
      console.log('[fetchUrl] Converting relative URL to:', fullUrl);
    }

    const urlModule = fullUrl.startsWith('https:') ? https : require('http');

    urlModule.get(fullUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1'
      }
    }, (res) => {
      let data = '';

      // Manejar todas las redirecciones (301, 302, 303, 307, 308)
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        console.log(`[fetchUrl] Redirect ${res.statusCode} to:`, res.headers.location);

        // Extraer base URL para redirecciones relativas
        const urlParts = fullUrl.match(/^(https?:\/\/[^\/]+)/);
        const newBaseUrl = urlParts ? urlParts[1] : 'https://suno.com';

        return fetchUrl(res.headers.location, newBaseUrl).then(resolve).catch(reject);
      }

      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
        return;
      }

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        resolve(data);
      });
    }).on('error', (err) => {
      reject(err);
    });
  });
}

// Función auxiliar para descargar audio
function downloadAudio(audioUrl, title, baseUrl = null) {
  return new Promise((resolve, reject) => {
    // Crear directorio de audios descargados si no existe
    const audiosDir = path.join(__dirname, 'suno_audios');
    if (!fs.existsSync(audiosDir)) {
      fs.mkdirSync(audiosDir, { recursive: true });
    }

    // Sanitizar nombre de archivo
    const sanitizedTitle = title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const timestamp = Date.now();
    const filename = `${sanitizedTitle}_${timestamp}.mp3`;
    const filepath = path.join(audiosDir, filename);

    console.log('[downloadAudio] Downloading to:', filepath);

    // Si la URL es relativa, construir URL completa
    let fullUrl = audioUrl;
    if (audioUrl.startsWith('/')) {
      if (!baseUrl) {
        baseUrl = 'https://suno.com';
      }
      fullUrl = baseUrl + audioUrl;
      console.log('[downloadAudio] Converting relative URL to:', fullUrl);
    }

    const file = fs.createWriteStream(filepath);
    const urlModule = fullUrl.startsWith('https:') ? https : require('http');

    urlModule.get(fullUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    }, (res) => {
      // Manejar todas las redirecciones (301, 302, 303, 307, 308)
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        console.log(`[downloadAudio] Redirect ${res.statusCode} to:`, res.headers.location);
        file.close();
        fs.unlinkSync(filepath);

        // Extraer base URL para redirecciones relativas
        const urlParts = fullUrl.match(/^(https?:\/\/[^\/]+)/);
        const newBaseUrl = urlParts ? urlParts[1] : 'https://suno.com';

        return downloadAudio(res.headers.location, title, newBaseUrl).then(resolve).catch(reject);
      }

      if (res.statusCode !== 200) {
        file.close();
        fs.unlinkSync(filepath);
        reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
        return;
      }

      res.pipe(file);

      file.on('finish', () => {
        file.close();
        console.log('[downloadAudio] Download complete');
        resolve(filepath);
      });
    }).on('error', (err) => {
      file.close();
      if (fs.existsSync(filepath)) {
        fs.unlinkSync(filepath);
      }
      reject(err);
    });
  });
}
