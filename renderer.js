// ==================== ESTADO GLOBAL ====================
let videos = [];
let selectedAudioPath = null;
let selectedBgPath = null;
let selectedBgVideoPath = null;
let selectedLogoPath = null;
let selectedDefaultLogoPath = null; // Logo por defecto de settings
let currentGeneratingIds = new Set(); // Permite múltiples generaciones
let editingVideoId = null; // ID del video que se está editando

// Estado para preview animado
let previewPlaying = false;
let previewAnimationId = null;
let previewVideoData = null;
let previewAudio = null;
let previewBassLevels = null;
let previewStartTime = 0;

// ==================== INICIALIZACIÓN ====================
document.addEventListener('DOMContentLoaded', async () => {
  await loadVideos();
  await loadSettings();
  initEventListeners();
});

// ==================== SETTINGS ====================
async function loadSettings() {
  const settings = await window.electronAPI.getSettings();
  if (settings.geminiApiKey) {
    document.getElementById('geminiApiKey').value = settings.geminiApiKey;
  }
  if (settings.defaultLogoPath) {
    selectedDefaultLogoPath = settings.defaultLogoPath;
    const fileName = settings.defaultLogoPath.split(/[\\/]/).pop();
    document.getElementById('defaultLogoFileName').textContent = fileName;
    document.getElementById('defaultLogoBtn').classList.add('selected');
  }
}

// ==================== CARGAR VIDEOS ====================
async function loadVideos() {
  videos = await window.electronAPI.getVideos();
  renderTable();
}

// ==================== RENDERIZAR TABLA ====================
function renderTable() {
  const tbody = document.getElementById('videosTableBody');

  if (videos.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" class="empty-state">
          <div class="empty-state-icon">📹</div>
          <div>No hay videos todavía</div>
          <div style="font-size: 14px; margin-top: 8px;">Haz clic en "Nuevo Video" para comenzar</div>
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = videos.map(video => `
    <tr>
      <td>
        <strong>${escapeHtml(video.title)}</strong>
      </td>
      <td>
        <span class="status-badge status-${video.status}">
          ${video.status === 'generating' ? '<span class="spinner"></span>' : ''}
          ${getStatusText(video.status)}
        </span>
      </td>
      <td>${formatDate(video.createdAt)}</td>
      <td>
        ${video.status === 'generating' ? `
          <div class="progress-bar">
            <div class="progress-fill" id="progress-${video.id}" style="width: 0%"></div>
          </div>
        ` : '—'}
      </td>
      <td>
        <div class="actions">
          <button type="button" class="actions-btn" data-video-id="${video.id}">⋮</button>
          <div class="actions-menu" id="actions-${video.id}">
            ${getActionsHTML(video)}
          </div>
        </div>
      </td>
    </tr>
  `).join('');
}

function getStatusText(status) {
  const statusMap = {
    pending: 'Pendiente',
    generating: 'Generando',
    completed: 'Completado',
    error: 'Error'
  };
  return statusMap[status] || status;
}

function formatDate(isoDate) {
  const date = new Date(isoDate);
  const now = new Date();
  const diff = now - date;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return 'Ahora';
  if (minutes < 60) return `Hace ${minutes}m`;
  if (hours < 24) return `Hace ${hours}h`;
  if (days < 7) return `Hace ${days}d`;

  return date.toLocaleDateString('es-ES', {
    day: 'numeric',
    month: 'short',
    year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
  });
}

function getActionsHTML(video) {
  const isGenerating = video.status === 'generating';
  const isCompleted = video.status === 'completed';
  const isPending = video.status === 'pending';

  return `
    <button type="button" data-action="preview" data-id="${video.id}" ${isGenerating ? 'disabled' : ''}>
      <span>👁️</span> Preview
    </button>
    <button type="button" data-action="generate" data-id="${video.id}" ${isGenerating || isCompleted ? 'disabled' : ''}>
      <span>🎬</span> Generate
    </button>
    ${isCompleted ? `
      <button type="button" data-action="view" data-id="${video.id}">
        <span>▶️</span> View
      </button>
      <button type="button" data-action="open-folder" data-id="${video.id}">
        <span>📂</span> Open Folder
      </button>
    ` : ''}
    <button type="button" data-action="edit" data-id="${video.id}" ${isGenerating ? 'disabled' : ''}>
      <span>✏️</span> Edit
    </button>
    <button type="button" data-action="duplicate" data-id="${video.id}">
      <span>📋</span> Duplicate
    </button>
    <button type="button" data-action="delete" data-id="${video.id}" ${isGenerating ? 'disabled' : ''} class="danger">
      <span>🗑️</span> Delete
    </button>
  `;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ==================== EVENT LISTENERS ====================
function initEventListeners() {
  // Modal nuevo video
  document.getElementById('newVideoBtn').addEventListener('click', openNewVideoModal);
  document.getElementById('closeModalBtn').addEventListener('click', closeNewVideoModal);
  document.getElementById('cancelModalBtn').addEventListener('click', closeNewVideoModal);
  document.getElementById('createVideoBtn').addEventListener('click', handleCreateVideo);

  // Archivos en modal
  document.getElementById('audioFileBtn').addEventListener('click', selectAudio);
  document.getElementById('bgFileBtn').addEventListener('click', selectBg);
  document.getElementById('bgVideoBtn').addEventListener('click', selectBgVideo);
  document.getElementById('logoFileBtn').addEventListener('click', selectLogo);

  // Switch entre texto e imagen
  document.getElementById('contentTypeText').addEventListener('change', toggleContentType);
  document.getElementById('contentTypeImage').addEventListener('change', toggleContentType);

  // Switch entre imagen y video de fondo
  document.getElementById('bgTypeImage').addEventListener('change', toggleBgType);
  document.getElementById('bgTypeVideo').addEventListener('change', toggleBgType);

  // Preview modal
  document.getElementById('closePreviewBtn').addEventListener('click', closePreviewModal);
  document.getElementById('playPreviewBtn').addEventListener('click', togglePreviewPlayback);
  document.getElementById('regenerateMetadataBtn').addEventListener('click', handleRegenerateMetadata);

  // Settings modal
  document.getElementById('settingsBtn').addEventListener('click', openSettingsModal);
  document.getElementById('closeSettingsBtn').addEventListener('click', closeSettingsModal);
  document.getElementById('cancelSettingsBtn').addEventListener('click', closeSettingsModal);
  document.getElementById('saveSettingsBtn').addEventListener('click', handleSaveSettings);
  document.getElementById('defaultLogoBtn').addEventListener('click', selectDefaultLogo);

  // Cerrar modal al hacer clic fuera
  document.getElementById('newVideoModal').addEventListener('click', (e) => {
    if (e.target.id === 'newVideoModal') closeNewVideoModal();
  });
  document.getElementById('previewModal').addEventListener('click', (e) => {
    if (e.target.id === 'previewModal') closePreviewModal();
  });
  document.getElementById('settingsModal').addEventListener('click', (e) => {
    if (e.target.id === 'settingsModal') closeSettingsModal();
  });

  // Progreso de FFmpeg (ahora manejado por video específico)
  window.electronAPI.onFFmpegProgress((percent) => {
    // El progreso se maneja en la función generateVideo
  });

  // Manejar click en botón de acciones
  document.addEventListener('click', (e) => {
    const actionsBtn = e.target.closest('.actions-btn');

    if (actionsBtn) {
      e.preventDefault();
      e.stopPropagation();

      const videoId = actionsBtn.getAttribute('data-video-id');
      const menu = document.getElementById(`actions-${videoId}`);
      const isShown = menu.classList.contains('show');

      // Cerrar todos los menús
      document.querySelectorAll('.actions-menu').forEach(m => m.classList.remove('show'));

      // Toggle el clickeado
      if (!isShown) {
        const rect = actionsBtn.getBoundingClientRect();
        menu.style.top = `${rect.bottom + 4}px`;
        menu.style.left = `${rect.right - 160}px`;
        menu.classList.add('show');
      }
    } else if (!e.target.closest('.actions')) {
      // Cerrar menús al hacer clic fuera
      document.querySelectorAll('.actions-menu').forEach(menu => {
        menu.classList.remove('show');
      });
    }
  });

  // Delegación de eventos para botones de acción
  document.addEventListener('click', async (e) => {
    const actionBtn = e.target.closest('[data-action]');
    if (!actionBtn) return;

    e.preventDefault();
    e.stopPropagation();

    const action = actionBtn.getAttribute('data-action');
    const id = actionBtn.getAttribute('data-id');

    if (actionBtn.disabled) return;

    try {
      switch(action) {
        case 'preview':
          await handlePreview(id);
          break;
        case 'generate':
          await handleGenerate(id);
          break;
        case 'view':
          await handleView(id);
          break;
        case 'open-folder':
          await handleOpenFolder(id);
          break;
        case 'edit':
          await handleEdit(id);
          break;
        case 'duplicate':
          await handleDuplicate(id);
          break;
        case 'delete':
          await handleDelete(id);
          break;
      }
    } catch (error) {
      console.error('Error in action handler:', action, error);
      showToast('error', 'Error', `Error en acción ${action}: ${error.message}`);
    }
  });
}

// ==================== MODAL SETTINGS ====================
function openSettingsModal() {
  document.getElementById('settingsModal').classList.add('show');
}

function closeSettingsModal() {
  document.getElementById('settingsModal').classList.remove('show');
}

async function selectDefaultLogo() {
  const filePath = await window.electronAPI.selectBgFile();
  if (filePath) {
    selectedDefaultLogoPath = filePath;
    const fileName = filePath.split(/[\\/]/).pop();
    document.getElementById('defaultLogoFileName').textContent = fileName;
    document.getElementById('defaultLogoBtn').classList.add('selected');
  }
}

async function handleSaveSettings() {
  const apiKey = document.getElementById('geminiApiKey').value.trim();

  try {
    await window.electronAPI.saveSettings({
      geminiApiKey: apiKey,
      defaultLogoPath: selectedDefaultLogoPath || null
    });
    showToast('success', 'Settings saved', 'Settings guardados exitosamente');
    closeSettingsModal();
  } catch (error) {
    showToast('error', 'Error', 'Failed to save settings: ' + error.message);
  }
}

// ==================== MODAL NUEVO VIDEO ====================
function openNewVideoModal() {
  document.getElementById('newVideoModal').classList.add('show');
  resetForm();
}

function closeNewVideoModal() {
  document.getElementById('newVideoModal').classList.remove('show');
  resetForm();
  editingVideoId = null; // Limpiar ID de edición

  // Restaurar el botón a "Crear" si estaba en modo edición
  const createBtn = document.getElementById('createVideoBtn');
  createBtn.textContent = 'Crear';
}

function resetForm() {
  document.getElementById('newVideoForm').reset();
  selectedAudioPath = null;
  selectedBgPath = null;
  selectedBgVideoPath = null;
  selectedLogoPath = null;
  document.getElementById('audioFileName').textContent = 'Seleccionar archivo de audio...';
  document.getElementById('bgFileName').textContent = 'Seleccionar imagen (opcional)';
  document.getElementById('bgVideoName').textContent = 'Seleccionar video (opcional)';
  document.getElementById('logoFileName').textContent = 'Seleccionar imagen para logo...';
  document.getElementById('audioFileBtn').classList.remove('selected');
  document.getElementById('bgFileBtn').classList.remove('selected');
  document.getElementById('bgVideoBtn').classList.remove('selected');
  document.getElementById('logoFileBtn').classList.remove('selected');
  document.getElementById('contentTypeText').checked = true;
  document.getElementById('bgTypeImage').checked = true;
  toggleContentType();
  toggleBgType();
}

function toggleContentType() {
  const textSelected = document.getElementById('contentTypeText').checked;
  document.getElementById('textContent').style.display = textSelected ? 'block' : 'none';
  document.getElementById('imageContent').style.display = textSelected ? 'none' : 'block';
}

function toggleBgType() {
  const imageSelected = document.getElementById('bgTypeImage').checked;
  document.getElementById('bgImageContent').style.display = imageSelected ? 'block' : 'none';
  document.getElementById('bgVideoContent').style.display = imageSelected ? 'none' : 'block';
}

async function selectAudio() {
  const filePath = await window.electronAPI.selectAudioFile();
  if (filePath) {
    selectedAudioPath = filePath;
    const fileName = filePath.split(/[\\/]/).pop();
    document.getElementById('audioFileName').textContent = fileName;
    document.getElementById('audioFileBtn').classList.add('selected');
  }
}

async function selectBg() {
  const filePath = await window.electronAPI.selectBgFile();
  if (filePath) {
    selectedBgPath = filePath;
    const fileName = filePath.split(/[\\/]/).pop();
    document.getElementById('bgFileName').textContent = fileName;
    document.getElementById('bgFileBtn').classList.add('selected');
  }
}

async function selectBgVideo() {
  const filePath = await window.electronAPI.selectBgVideo();
  if (filePath) {
    selectedBgVideoPath = filePath;
    const fileName = filePath.split(/[\\/]/).pop();
    document.getElementById('bgVideoName').textContent = fileName;
    document.getElementById('bgVideoBtn').classList.add('selected');
  }
}

async function selectLogo() {
  const filePath = await window.electronAPI.selectBgFile();
  if (filePath) {
    selectedLogoPath = filePath;
    const fileName = filePath.split(/[\\/]/).pop();
    document.getElementById('logoFileName').textContent = fileName;
    document.getElementById('logoFileBtn').classList.add('selected');
  }
}

async function handleCreateVideo() {
  const title = document.getElementById('videoTitle').value.trim();
  const color = document.getElementById('videoColor').value;
  const text = document.getElementById('videoText').value.trim();
  const useImage = document.getElementById('contentTypeImage').checked;
  const sunoLyrics = document.getElementById('sunoLyrics').value.trim();
  const sunoStyles = document.getElementById('sunoStyles').value.trim();

  if (!title) {
    showToast('error', 'Error', 'Por favor ingresa un título');
    return;
  }

  if (!selectedAudioPath) {
    showToast('error', 'Error', 'Por favor selecciona un archivo de audio');
    return;
  }

  // Determinar el logoPath a usar
  let finalLogoPath = null;
  if (useImage) {
    // Si está en modo imagen, usar la imagen seleccionada
    finalLogoPath = selectedLogoPath;
  } else {
    // Si está en modo texto pero no hay texto, usar el logo por defecto de settings
    if (!text && selectedDefaultLogoPath) {
      finalLogoPath = selectedDefaultLogoPath;
    }
  }

  // Generar metadatos de YouTube si hay lyrics o styles (al menos uno)
  let youtubeMetadata = null;
  if (sunoLyrics || sunoStyles) {
    try {
      showToast('info', 'Generando metadatos', 'Generando metadatos de YouTube con Gemini...', false);
      youtubeMetadata = await window.electronAPI.generateYoutubeMetadata({
        sunoLyrics: sunoLyrics || 'No lyrics provided',
        sunoStyles: sunoStyles || 'General music'
      });
      document.querySelectorAll('.toast').forEach(t => t.remove());
      showToast('success', 'Metadatos generados', 'Metadatos de YouTube generados exitosamente');
    } catch (error) {
      console.error('Error generating YouTube metadata:', error);
      showToast('error', 'Error', error.message || 'Failed to generate YouTube metadata');
      // Continuar sin metadatos
    }
  }

  // Si estamos editando, actualizar en lugar de crear
  if (editingVideoId) {
    const updatedData = {
      title,
      audioPath: selectedAudioPath,
      bgPath: selectedBgPath,
      bgVideoPath: selectedBgVideoPath,
      color,
      text: useImage ? '' : text,
      logoPath: finalLogoPath,
      sunoLyrics,
      sunoStyles,
      status: 'pending' // Resetear a pending cuando se edita
    };

    // Añadir metadatos si fueron generados
    if (youtubeMetadata) {
      updatedData.youtubeTitle = youtubeMetadata.title;
      updatedData.youtubeDescription = youtubeMetadata.description;
      updatedData.youtubeTags = youtubeMetadata.tags;
    }

    // Actualizar en la base de datos
    const updatedVideo = await window.electronAPI.updateVideo(editingVideoId, updatedData);

    // Actualizar el array local sin cambiar el orden
    if (updatedVideo) {
      const index = videos.findIndex(v => v.id === editingVideoId);
      if (index !== -1) {
        videos[index] = updatedVideo;
      }
    }

    renderTable();
    closeNewVideoModal();
    showToast('success', 'Video actualizado', `"${title}" actualizado exitosamente`);
    return;
  }

  // Crear nuevo video
  const videoData = {
    title,
    audioPath: selectedAudioPath,
    bgPath: selectedBgPath,
    bgVideoPath: selectedBgVideoPath,
    color,
    text: text,
    logoPath: finalLogoPath,
    sunoLyrics,
    sunoStyles
  };

  // Añadir metadatos si fueron generados
  if (youtubeMetadata) {
    videoData.youtubeTitle = youtubeMetadata.title;
    videoData.youtubeDescription = youtubeMetadata.description;
    videoData.youtubeTags = youtubeMetadata.tags;
  }

  const newVideo = await window.electronAPI.createVideo(videoData);
  videos.unshift(newVideo);
  renderTable();
  closeNewVideoModal();
  showToast('success', 'Video creado', `"${title}" agregado a la lista`);
}

// ==================== ACCIONES ====================
async function handlePreview(id) {
  const video = videos.find(v => v.id === id);
  if (!video) return;

  // Cerrar menú de acciones
  document.querySelectorAll('.actions-menu').forEach(m => m.classList.remove('show'));

  // Mostrar toast de carga
  showToast('info', 'Cargando', 'Preparando preview...', false);

  try {
    // Guardar datos del video para preview
    previewVideoData = JSON.parse(JSON.stringify(video)); // Clone profundo

    // Cargar imágenes si existen
    if (previewVideoData.bgPath) {
      previewVideoData.bgImage = await loadImage('file:///' + previewVideoData.bgPath.replace(/\\/g, '/'));
    }
    // Cargar video de fondo si existe
    if (previewVideoData.bgVideoPath) {
      previewVideoData.bgVideo = await loadVideo('file:///' + previewVideoData.bgVideoPath.replace(/\\/g, '/'));
    }
    if (previewVideoData.logoPath) {
      previewVideoData.logoImage = await loadImage('file:///' + previewVideoData.logoPath.replace(/\\/g, '/'));
    }

    // Cargar y analizar audio para preview
    const audioSrc = 'file:///' + video.audioPath.replace(/\\/g, '/');
    const response = await fetch(audioSrc);
    const arrayBuffer = await response.arrayBuffer();

    // Crear audio element
    previewAudio = new Audio();
    const blob = new Blob([arrayBuffer], { type: 'audio/mpeg' });
    const blobUrl = URL.createObjectURL(blob);
    previewAudio.src = blobUrl;

    await new Promise((resolve) => {
      previewAudio.addEventListener('loadedmetadata', resolve);
    });

    // Analizar audio para obtener bassLevels reales
    const fps = 60;
    const totalFrames = Math.ceil(previewAudio.duration * fps);

    previewBassLevels = await window.electronAPI.analyzeAudioFFmpeg({
      audioPath: video.audioPath,
      totalFrames: totalFrames,
      fps: fps
    });

    // Cerrar toast de carga
    document.querySelectorAll('.toast').forEach(t => t.remove());

    // Renderizar primer frame
    const canvas = document.getElementById('previewCanvas');
    const ctx = canvas.getContext('2d');
    await renderPreview(ctx, canvas, previewVideoData);

    // Reset play button
    previewPlaying = false;
    updatePlayButton();

    // Mostrar metadatos de YouTube si existen o si hay Suno Lyrics/Styles
    const hasMetadata = !!(video.youtubeTitle || video.youtubeDescription || video.youtubeTags);
    const hasSunoData = !!(video.sunoLyrics || video.sunoStyles); // Al menos uno de los dos

    // Debug info
    console.log('[handlePreview] Video ID:', video.id);
    console.log('[handlePreview] Has Metadata:', hasMetadata);
    console.log('[handlePreview] Has Suno Data:', hasSunoData);
    console.log('[handlePreview] Suno Lyrics:', video.sunoLyrics);
    console.log('[handlePreview] Suno Styles:', video.sunoStyles);

    if (hasMetadata || hasSunoData) {
      document.getElementById('youtubeMetadata').style.display = 'block';
      document.getElementById('ytTitle').value = video.youtubeTitle || '';
      document.getElementById('ytDescription').value = video.youtubeDescription || '';
      document.getElementById('ytTags').value = video.youtubeTags || '';

      // Cambiar texto del botón si no hay metadatos
      const regenerateBtn = document.getElementById('regenerateMetadataBtn');
      if (!hasMetadata && hasSunoData) {
        regenerateBtn.innerHTML = '<span>✨</span> Generar Metadatos';
      } else {
        regenerateBtn.innerHTML = '<span>🔄</span> Regenerar';
      }
    } else {
      document.getElementById('youtubeMetadata').style.display = 'none';
    }

    // Mostrar modal
    document.getElementById('previewModal').classList.add('show');
  } catch (error) {
    console.error('[handlePreview] Error:', error);
    showToast('error', 'Error', 'Error preparando preview: ' + error.message);
  }
}

function closePreviewModal() {
  document.getElementById('previewModal').classList.remove('show');
  stopPreviewPlayback();
  previewVideoData = null;
  previewBassLevels = null;
  if (previewAudio) {
    previewAudio.pause();
    previewAudio.src = '';
    previewAudio = null;
  }
}

async function handleRegenerateMetadata() {
  if (!previewVideoData) return;

  const video = videos.find(v => v.id === previewVideoData.id);
  if (!video || (!video.sunoLyrics && !video.sunoStyles)) {
    showToast('error', 'Error', 'No Suno Lyrics or Styles found for this video');
    return;
  }

  try {
    showToast('info', 'Regenerando', 'Regenerando metadatos de YouTube con Gemini...', false);

    const youtubeMetadata = await window.electronAPI.generateYoutubeMetadata({
      sunoLyrics: video.sunoLyrics || 'No lyrics provided',
      sunoStyles: video.sunoStyles || 'General music'
    });

    // Actualizar en la base de datos
    await window.electronAPI.updateVideo(video.id, {
      youtubeTitle: youtubeMetadata.title,
      youtubeDescription: youtubeMetadata.description,
      youtubeTags: youtubeMetadata.tags
    });

    // Actualizar en el array local
    const index = videos.findIndex(v => v.id === video.id);
    if (index !== -1) {
      videos[index].youtubeTitle = youtubeMetadata.title;
      videos[index].youtubeDescription = youtubeMetadata.description;
      videos[index].youtubeTags = youtubeMetadata.tags;
    }

    // Actualizar los campos en el modal
    document.getElementById('ytTitle').value = youtubeMetadata.title;
    document.getElementById('ytDescription').value = youtubeMetadata.description;
    document.getElementById('ytTags').value = youtubeMetadata.tags;
    document.getElementById('youtubeMetadata').style.display = 'block';

    // Actualizar previewVideoData
    previewVideoData.youtubeTitle = youtubeMetadata.title;
    previewVideoData.youtubeDescription = youtubeMetadata.description;
    previewVideoData.youtubeTags = youtubeMetadata.tags;

    document.querySelectorAll('.toast').forEach(t => t.remove());
    showToast('success', 'Metadatos regenerados', 'Metadatos de YouTube regenerados exitosamente');
  } catch (error) {
    console.error('Error regenerating YouTube metadata:', error);
    document.querySelectorAll('.toast').forEach(t => t.remove());
    showToast('error', 'Error', error.message || 'Failed to regenerate YouTube metadata');
  }
}

function togglePreviewPlayback() {
  if (previewPlaying) {
    stopPreviewPlayback();
  } else {
    startPreviewPlayback();
  }
}

function updatePlayButton() {
  const icon = document.getElementById('playPreviewIcon');
  const text = document.getElementById('playPreviewText');

  if (previewPlaying) {
    icon.textContent = '⏸';
    text.textContent = 'Pausar';
  } else {
    icon.textContent = '▶';
    text.textContent = 'Reproducir';
  }
}

function startPreviewPlayback() {
  if (!previewVideoData || !previewBassLevels || !previewAudio || previewPlaying) return;

  previewPlaying = true;
  updatePlayButton();

  // Reproducir audio
  previewAudio.currentTime = 0;
  previewAudio.play();

  // Reproducir video de fondo si existe
  if (previewVideoData.bgVideo) {
    previewVideoData.bgVideo.currentTime = 0;
    previewVideoData.bgVideo.play();
  }

  previewStartTime = performance.now();

  const canvas = document.getElementById('previewCanvas');
  const ctx = canvas.getContext('2d');

  let bassSmooth = 0;
  let beatBoost = 0;
  const particles = [];
  const fps = 60;

  function animate() {
    if (!previewPlaying) return;

    // Calcular frame actual basado en tiempo de audio
    const currentTime = previewAudio.currentTime;
    const frameIndex = Math.floor(currentTime * fps);

    // Si llegamos al final, detener
    if (frameIndex >= previewBassLevels.length || previewAudio.ended) {
      stopPreviewPlayback();
      return;
    }

    // Obtener nivel de bajos real del análisis
    const level = previewBassLevels[frameIndex] || 0;
    const prevLevel = frameIndex > 0 ? previewBassLevels[frameIndex - 1] : 0;
    const delta = Math.max(0, level - prevLevel);

    // Actualizar estado
    bassSmooth = bassSmooth * 0.82 + level * 0.18;
    beatBoost = beatBoost * 0.65 + delta * 1.6 * 0.35;

    // Emitir partículas
    const emission = Math.floor((delta * 90) + (level * 20));
    if (emission > 0) {
      spawnParticles(particles, emission, bassSmooth, beatBoost, previewVideoData.color, canvas);
    }

    // Renderizar
    renderFrame(ctx, canvas, particles, bassSmooth, beatBoost, previewVideoData, previewVideoData.bgImage);

    previewAnimationId = requestAnimationFrame(animate);
  }

  animate();
}

function stopPreviewPlayback() {
  previewPlaying = false;
  updatePlayButton();

  // Pausar audio
  if (previewAudio) {
    previewAudio.pause();
  }

  // Pausar video de fondo si existe
  if (previewVideoData && previewVideoData.bgVideo) {
    previewVideoData.bgVideo.pause();
  }

  if (previewAnimationId) {
    cancelAnimationFrame(previewAnimationId);
    previewAnimationId = null;
  }

  // Renderizar frame estático
  if (previewVideoData) {
    const canvas = document.getElementById('previewCanvas');
    const ctx = canvas.getContext('2d');
    renderPreview(ctx, canvas, previewVideoData);
  }
}

async function handleGenerate(id) {
  console.log('[handleGenerate] Iniciando con id:', id);

  const video = videos.find(v => v.id === id);
  if (!video) {
    console.error('[handleGenerate] Video no encontrado:', id);
    return;
  }

  console.log('[handleGenerate] Video encontrado:', video.title);

  // Cerrar menú de acciones
  document.querySelectorAll('.actions-menu').forEach(m => m.classList.remove('show'));

  // Agregar a generaciones en curso
  currentGeneratingIds.add(id);
  console.log('[handleGenerate] Agregado a generaciones en curso');

  // Actualizar estado a generating
  try {
    await window.electronAPI.updateVideo(id, { status: 'generating' });
    console.log('[handleGenerate] Estado actualizado a generating en BD');
  } catch (error) {
    console.error('[handleGenerate] Error actualizando estado:', error);
  }

  const index = videos.findIndex(v => v.id === id);
  if (index !== -1) {
    videos[index].status = 'generating';
  }
  renderTable();

  showToast('info', 'Generando', `Iniciando generación de "${video.title}"`);
  console.log('[handleGenerate] Toast mostrado, iniciando generateVideo...');

  // Generar en background
  try {
    await generateVideo(video);
    console.log('[handleGenerate] generateVideo completado exitosamente');

    // Actualizar estado a completed
    const videoIndex = videos.findIndex(v => v.id === id);
    if (videoIndex !== -1) {
      videos[videoIndex].status = 'completed';
    }
    renderTable();

    showToast('success', 'Completado', `"${video.title}" generado exitosamente`);
  } catch (error) {
    console.error('[handleGenerate] Error generating video:', error);
    console.error('[handleGenerate] Error stack:', error.stack);

    await window.electronAPI.updateVideo(id, {
      status: 'error',
      error: error.message
    });

    const videoIndex = videos.findIndex(v => v.id === id);
    if (videoIndex !== -1) {
      videos[videoIndex].status = 'error';
      videos[videoIndex].error = error.message;
    }
    renderTable();

    showToast('error', 'Error', `Error al generar "${video.title}": ${error.message}`);
  } finally {
    currentGeneratingIds.delete(id);
    console.log('[handleGenerate] Finalizado');
  }
}

async function handleView(id) {
  const video = videos.find(v => v.id === id);
  if (!video || !video.outputPath) return;

  // Cerrar menú
  document.querySelectorAll('.actions-menu').forEach(m => m.classList.remove('show'));

  // Abrir el video directamente
  await window.electronAPI.openVideoFile(video.outputPath);
}

async function handleOpenFolder(id) {
  const video = videos.find(v => v.id === id);
  if (!video || !video.outputPath) return;

  // Cerrar menú
  document.querySelectorAll('.actions-menu').forEach(m => m.classList.remove('show'));

  await window.electronAPI.openVideoFolder(video.outputPath);
}

async function handleEdit(id) {
  const video = videos.find(v => v.id === id);
  if (!video) return;

  // Cerrar menú
  document.querySelectorAll('.actions-menu').forEach(m => m.classList.remove('show'));

  // Establecer el ID de edición
  editingVideoId = id;

  // Prellenar el formulario con los datos del video
  document.getElementById('videoTitle').value = video.title;
  document.getElementById('videoColor').value = video.color;
  document.getElementById('videoText').value = video.text || '';
  document.getElementById('sunoLyrics').value = video.sunoLyrics || '';
  document.getElementById('sunoStyles').value = video.sunoStyles || '';

  // Configurar audio
  selectedAudioPath = video.audioPath;
  const audioFileName = video.audioPath.split(/[\\/]/).pop();
  document.getElementById('audioFileName').textContent = audioFileName;
  document.getElementById('audioFileBtn').classList.add('selected');

  // Configurar fondo
  if (video.bgVideoPath) {
    selectedBgVideoPath = video.bgVideoPath;
    const videoFileName = video.bgVideoPath.split(/[\\/]/).pop();
    document.getElementById('bgVideoName').textContent = videoFileName;
    document.getElementById('bgVideoBtn').classList.add('selected');
    document.getElementById('bgTypeVideo').checked = true;
    toggleBgType();
  } else if (video.bgPath) {
    selectedBgPath = video.bgPath;
    const bgFileName = video.bgPath.split(/[\\/]/).pop();
    document.getElementById('bgFileName').textContent = bgFileName;
    document.getElementById('bgFileBtn').classList.add('selected');
    document.getElementById('bgTypeImage').checked = true;
    toggleBgType();
  }

  // Configurar logo/contenido
  if (video.logoPath) {
    selectedLogoPath = video.logoPath;
    const logoFileName = video.logoPath.split(/[\\/]/).pop();
    document.getElementById('logoFileName').textContent = logoFileName;
    document.getElementById('logoFileBtn').classList.add('selected');
    document.getElementById('contentTypeImage').checked = true;
    toggleContentType();
  } else {
    document.getElementById('contentTypeText').checked = true;
    toggleContentType();
  }

  // Cambiar el texto del botón
  const createBtn = document.getElementById('createVideoBtn');
  createBtn.textContent = 'Actualizar';

  // Abrir modal
  document.getElementById('newVideoModal').classList.add('show');
}

async function handleDuplicate(id) {
  const video = videos.find(v => v.id === id);
  if (!video) return;

  // Cerrar menú
  document.querySelectorAll('.actions-menu').forEach(m => m.classList.remove('show'));

  // Crear una copia del video con un nuevo ID
  const duplicatedVideo = {
    title: `${video.title} (Copia)`,
    audioPath: video.audioPath,
    bgPath: video.bgPath || null,
    bgVideoPath: video.bgVideoPath || null,
    logoPath: video.logoPath || null,
    color: video.color,
    text: video.text,
    sunoLyrics: video.sunoLyrics || '',
    sunoStyles: video.sunoStyles || ''
    // No copiar metadatos de YouTube para permitir regenerarlos
  };

  const newVideo = await window.electronAPI.createVideo(duplicatedVideo);
  videos.unshift(newVideo);
  renderTable();
  showToast('success', 'Video duplicado', `"${duplicatedVideo.title}" creado exitosamente`);
}

async function handleDelete(id) {
  const video = videos.find(v => v.id === id);
  if (!video) return;

  // Cerrar menú
  document.querySelectorAll('.actions-menu').forEach(m => m.classList.remove('show'));

  // Usar confirmación nativa de Electron (no recarga la página)
  const confirmDelete = await new Promise(resolve => {
    const toast = showToast('warning', 'Confirmar', `¿Eliminar "${video.title}"?`, false);

    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = 'btn btn-primary';
    confirmBtn.style.cssText = 'padding: 6px 12px; font-size: 12px; margin-right: 8px;';
    confirmBtn.textContent = 'Eliminar';
    confirmBtn.onclick = () => {
      toast.remove();
      resolve(true);
    };

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'btn';
    cancelBtn.style.cssText = 'padding: 6px 12px; font-size: 12px;';
    cancelBtn.textContent = 'Cancelar';
    cancelBtn.onclick = () => {
      toast.remove();
      resolve(false);
    };

    const actions = document.createElement('div');
    actions.style.cssText = 'display: flex; margin-top: 12px;';
    actions.appendChild(confirmBtn);
    actions.appendChild(cancelBtn);

    toast.querySelector('.toast-content').appendChild(actions);
  });

  if (!confirmDelete) return;

  await window.electronAPI.deleteVideo(id);
  videos = videos.filter(v => v.id !== id);
  renderTable();
  showToast('success', 'Eliminado', `"${video.title}" eliminado`);
}

function updateProgress(id, percent) {
  const progressFill = document.getElementById(`progress-${id}`);
  if (progressFill) {
    progressFill.style.width = `${percent}%`;
  }
}

// ==================== GENERACIÓN DE VIDEO ====================
async function generateVideo(video) {
  console.log('[generateVideo] Iniciando para:', video.title);
  console.log('[generateVideo] audioPath:', video.audioPath);

  const audioSrc = 'file:///' + video.audioPath.replace(/\\/g, '/');
  console.log('[generateVideo] audioSrc:', audioSrc);

  // Cargar audio una sola vez con fetch
  console.log('[generateVideo] Fetching audio file...');
  const response = await fetch(audioSrc);
  console.log('[generateVideo] Fetch completado, convirtiendo a arrayBuffer...');
  const arrayBuffer = await response.arrayBuffer();
  console.log('[generateVideo] ArrayBuffer size:', arrayBuffer.byteLength);

  // Crear elemento audio para obtener duración
  const audio = new Audio();
  const blob = new Blob([arrayBuffer], { type: 'audio/mpeg' });
  const blobUrl = URL.createObjectURL(blob);
  audio.src = blobUrl;

  console.log('[generateVideo] Esperando loadedmetadata...');
  await new Promise((resolve, reject) => {
    audio.addEventListener('loadedmetadata', () => {
      console.log('[generateVideo] loadedmetadata recibido, duration:', audio.duration);
      resolve();
    });
    audio.addEventListener('error', (e) => {
      console.error('[generateVideo] Error cargando audio:', e);
      reject(new Error('Error cargando audio: ' + e.message));
    });
  });

  console.log('[generateVideo] Audio cargado exitosamente');

  const fps = 60;
  const audioDuration = audio.duration;
  const totalFrames = Math.ceil(audioDuration * fps);
  const framesDir = window.electronAPI.getTempDir() + '/visualizer_frames_' + Date.now();

  console.log('[generateVideo] Configuración:', { fps, audioDuration, totalFrames, framesDir });
  console.log('[generateVideo] Iniciando análisis de audio con FFmpeg...');

  // Usar FFmpeg para extraer datos de audio de forma confiable
  const bassLevels = await window.electronAPI.analyzeAudioFFmpeg({
    audioPath: video.audioPath,
    totalFrames: totalFrames,
    fps: fps
  });
  console.log('[generateVideo] bassLevels generados:', bassLevels.length);

  // Limpiar blob URL
  URL.revokeObjectURL(blobUrl);

  console.log('[generateVideo] Análisis de audio completado, bassLevels.length:', bassLevels.length);

  // Cargar imagen de fondo si existe
  let bgImage = null;
  if (video.bgPath) {
    bgImage = await loadImage('file:///' + video.bgPath.replace(/\\/g, '/'));
  }

  // Cargar video de fondo si existe
  let bgVideo = null;
  if (video.bgVideoPath) {
    bgVideo = await loadVideo('file:///' + video.bgVideoPath.replace(/\\/g, '/'));
    video.bgVideo = bgVideo;
  }

  // Cargar imagen de logo si existe
  let logoImage = null;
  if (video.logoPath) {
    logoImage = await loadImage('file:///' + video.logoPath.replace(/\\/g, '/'));
    video.logoImage = logoImage;
  }

  // Renderizar frames
  const canvas = document.getElementById('vizCanvas');
  const ctx = canvas.getContext('2d');

  let bassSmooth = 0;
  let beatBoost = 0;
  let lastLevel = 0;
  const particles = [];

  console.log('[generateVideo] Iniciando renderizado de frames...');

  // Procesar frames en lotes para mejor rendimiento
  const BATCH_SIZE = 30; // Procesar 30 frames antes de actualizar UI

  for (let frameNum = 0; frameNum < totalFrames; frameNum++) {
    const level = bassLevels[frameNum];
    const prevLevel = frameNum > 0 ? bassLevels[frameNum - 1] : 0;
    const delta = Math.max(0, level - prevLevel);

    // Sincronizar video de fondo si existe
    if (bgVideo) {
      const videoTime = (frameNum / fps) % bgVideo.duration;
      bgVideo.currentTime = videoTime;
      // Esperar a que el frame del video esté listo
      await new Promise(resolve => {
        if (bgVideo.readyState >= 2) {
          resolve();
        } else {
          bgVideo.addEventListener('loadeddata', resolve, { once: true });
        }
      });
    }

    // Actualizar estado
    bassSmooth = bassSmooth * 0.82 + level * 0.18;
    beatBoost = beatBoost * 0.65 + delta * 1.6 * 0.35;
    lastLevel = level;

    // Emitir partículas
    const emission = Math.floor((delta * 90) + (level * 20));
    if (emission > 0) {
      spawnParticles(particles, emission, bassSmooth, beatBoost, video.color, canvas);
    }

    // Renderizar frame
    renderFrame(ctx, canvas, particles, bassSmooth, beatBoost, video, bgImage);

    // Guardar frame
    const frameData = canvas.toDataURL('image/png');
    await window.electronAPI.saveFrame(frameData, frameNum + 1, framesDir);

    // Actualizar progreso cada BATCH_SIZE frames (fase 1: 70%)
    if (frameNum % BATCH_SIZE === 0 || frameNum === totalFrames - 1) {
      const percent = ((frameNum + 1) / totalFrames) * 70;
      updateProgress(video.id, percent);

      // Log progreso cada 300 frames
      if (frameNum % 300 === 0) {
        console.log(`[generateVideo] Frames renderizados: ${frameNum + 1}/${totalFrames} (${((frameNum + 1) / totalFrames * 100).toFixed(1)}%)`);
      }

      // Permitir que UI se actualice solo al final de cada lote
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }

  console.log('[generateVideo] Renderizado de frames completado');

  // Generar video con FFmpeg
  const outputsDir = await window.electronAPI.getOutputsDir();
  const outputPath = `${outputsDir}/${video.id}_${sanitizeFilename(video.title)}.mp4`;

  await window.electronAPI.generateVideo({
    audioPath: video.audioPath,
    framesDir: framesDir,
    outputPath: outputPath,
    fps: fps,
    totalFrames: totalFrames
  });

  // Limpiar frames
  await window.electronAPI.cleanupFrames(framesDir);

  // Actualizar video como completado
  await window.electronAPI.updateVideo(video.id, {
    status: 'completed',
    outputPath: outputPath
  });

  const index = videos.findIndex(v => v.id === video.id);
  if (index !== -1) {
    videos[index].status = 'completed';
    videos[index].outputPath = outputPath;
  }
  renderTable();
}

// ==================== ANÁLISIS DE AUDIO ====================
async function analyzeAudio(arrayBuffer, totalFrames, fps) {
  console.log('[analyzeAudio] Iniciando, totalFrames:', totalFrames);
  console.log('[analyzeAudio] ArrayBuffer size:', arrayBuffer.byteLength);

  try {
    // Usar AudioContext normal en lugar de OfflineAudioContext
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    console.log('[analyzeAudio] AudioContext creado, sampleRate:', audioContext.sampleRate);
    console.log('[analyzeAudio] Decodificando audio data...');

    // Crear una copia del arrayBuffer para evitar problemas de detached buffer
    const bufferCopy = arrayBuffer.slice(0);
    console.log('[analyzeAudio] Buffer copiado, size:', bufferCopy.byteLength);

    // Decodificar con manejo de promesas más explícito y timeout
    let audioBuffer;
    try {
      const decodePromise = new Promise((resolve, reject) => {
        console.log('[analyzeAudio] Llamando a decodeAudioData...');
        audioContext.decodeAudioData(
          bufferCopy,
          (buffer) => {
            console.log('[analyzeAudio] decodeAudioData success callback');
            resolve(buffer);
          },
          (error) => {
            console.error('[analyzeAudio] decodeAudioData error callback:', error);
            reject(error);
          }
        );
      });

      // Agregar timeout de 30 segundos
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Timeout decodificando audio (30s)')), 30000);
      });

      audioBuffer = await Promise.race([decodePromise, timeoutPromise]);
    } catch (decodeError) {
      console.error('[analyzeAudio] Error en decodeAudioData:', decodeError);

      // Cerrar el contexto de audio
      if (audioContext.state !== 'closed') {
        await audioContext.close();
      }

      throw new Error(`Error decodificando audio: ${decodeError.message || 'Unknown error'}`);
    }

    console.log('[analyzeAudio] Audio decodificado, duration:', audioBuffer.duration);

    const channelData = audioBuffer.getChannelData(0);
    const sampleRate = audioBuffer.sampleRate;
    const bassLevels = [];
    console.log('[analyzeAudio] Procesando frames...');

    for (let frame = 0; frame < totalFrames; frame++) {
      const time = frame / fps;
      const sampleIndex = Math.floor(time * sampleRate);
      const windowSize = 2048;
      let sum = 0;

      for (let i = 0; i < windowSize && sampleIndex + i < channelData.length; i++) {
        sum += Math.abs(channelData[sampleIndex + i]);
      }

      const avg = (sum / windowSize) * 255;
      const level = Math.pow(Math.min(avg / 255, 1), 1.5);
      bassLevels.push(level);

      // Log progress cada 1000 frames
      if (frame % 1000 === 0) {
        console.log(`[analyzeAudio] Progreso: ${frame}/${totalFrames} frames (${((frame/totalFrames)*100).toFixed(1)}%)`);
      }
    }

    console.log('[analyzeAudio] Completado, bassLevels generados:', bassLevels.length);

    // Cerrar el contexto de audio para liberar recursos
    if (audioContext.state !== 'closed') {
      await audioContext.close();
      console.log('[analyzeAudio] AudioContext cerrado');
    }

    return bassLevels;
  } catch (error) {
    console.error('[analyzeAudio] Error:', error);
    throw error;
  }
}

// ==================== RENDERIZADO ====================
function renderFrame(ctx, canvas, particles, level, boost, video, bgImage) {
  const w = canvas.width;
  const h = canvas.height;

  // Fondo
  if (video.bgVideo) {
    // Dibujar video de fondo (silenciado)
    ctx.drawImage(video.bgVideo, 0, 0, w, h);
  } else if (bgImage) {
    // Dibujar imagen de fondo
    ctx.drawImage(bgImage, 0, 0, w, h);
  } else {
    // Fondo sólido por defecto
    ctx.fillStyle = '#0b0f1a';
    ctx.fillRect(0, 0, w, h);
  }

  // Overlay
  ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
  ctx.fillRect(0, 0, w, h);

  // Contenido a la izquierda (texto o imagen)
  if (video.logoImage) {
    // Mostrar imagen/logo
    const maxLogoWidth = w * 0.35;
    const maxLogoHeight = h * 0.6;
    const logoAspect = video.logoImage.width / video.logoImage.height;

    let logoWidth = maxLogoWidth;
    let logoHeight = logoWidth / logoAspect;

    if (logoHeight > maxLogoHeight) {
      logoHeight = maxLogoHeight;
      logoWidth = logoHeight * logoAspect;
    }

    const logoX = 150;
    const logoY = (h - logoHeight) / 2;

    ctx.shadowBlur = 30;
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.drawImage(video.logoImage, logoX, logoY, logoWidth, logoHeight);
    ctx.shadowBlur = 0;
  } else if (video.text) {
    // Mostrar texto
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 96px Inter, sans-serif';
    ctx.textAlign = 'left';
    ctx.shadowBlur = 30;
    ctx.shadowColor = 'rgba(0,0,0,0.35)';

    const lines = video.text.split('\n');
    const lineHeight = 115;
    const totalHeight = lines.length * lineHeight;
    const startY = (h - totalHeight) / 2 + 96;

    lines.forEach((line, i) => {
      ctx.fillText(line, 150, startY + (i * lineHeight));
    });

    ctx.shadowBlur = 0;
  }

  // Visualizador a la derecha
  const vizSize = h * 0.75;
  const vizX = w * 0.70;
  const vizY = h / 2;

  ctx.save();
  ctx.translate(vizX, vizY);

  // Anillo con efecto de agrandamiento más pronunciado (20% más) y círculo base 20% más grande
  const baseR = vizSize * 0.336; // Aumentado de 0.28 a 0.336 (20% más grande)
  const pulse = (level * 1.08 + boost * 1.56); // Aumentado 20% para más visibilidad
  const radius = baseR * (1.0 + pulse * 0.54); // Aumentado 20%
  const glow = 22 + pulse * 72; // Aumentado 20%

  ctx.beginPath();
  ctx.lineWidth = Math.max(6, vizSize * 0.01);
  ctx.strokeStyle = video.color;
  ctx.shadowBlur = glow;
  ctx.shadowColor = video.color;
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.stroke();

  // Partículas orbitando con movimiento más pronunciado (20% más)
  const orbitCount = 120;
  for (let i = 0; i < orbitCount; i++) {
    const t = (i / orbitCount) * Math.PI * 2 + performance.now() / 900;
    const jitter = (Math.sin((i * 13.37 + performance.now() / 70) % Math.PI) * 0.5 + 0.5) * 4;
    const pr = radius + 8 + jitter + pulse * 21.6; // Aumentado 20% para más efecto visual
    const x = Math.cos(t) * pr;
    const y = Math.sin(t) * pr;

    ctx.beginPath();
    ctx.fillStyle = video.color;
    ctx.globalAlpha = 0.55 + Math.random() * 0.35;
    ctx.arc(x, y, 1.8 + Math.random() * 1.5 + pulse * 0.42, 0, Math.PI * 2); // Aumentado 20%
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  ctx.restore();

  // Dibujar partículas inward
  for (let i = particles.length - 1; i >= 0; i--) {
    if (!particles[i].update()) {
      particles.splice(i, 1);
      continue;
    }
    particles[i].draw(ctx, vizX, vizY);
  }
}

async function renderPreview(ctx, canvas, video) {
  // Cargar background si existe
  let bgImage = null;
  if (video.bgPath) {
    bgImage = await loadImage('file:///' + video.bgPath.replace(/\\/g, '/'));
  }

  const particles = [];
  renderFrame(ctx, canvas, particles, 0.3, 0.1, video, bgImage);
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function loadVideo(src) {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.muted = true; // IMPORTANTE: Silenciar el video
    video.loop = true; // Loop para que se repita durante toda la duración del audio
    video.playsInline = true;

    video.addEventListener('loadedmetadata', () => {
      video.currentTime = 0;
      resolve(video);
    });

    video.addEventListener('error', reject);
    video.src = src;
    video.load();
  });
}

// ==================== PARTÍCULAS ====================
class Particle {
  constructor(x, y, angle, speed, color) {
    this.x = x;
    this.y = y;
    this.vx = Math.cos(angle + Math.PI) * speed;
    this.vy = Math.sin(angle + Math.PI) * speed;
    this.life = 1;
    this.decay = 0.012 + Math.random() * 0.01;
    this.size = 1.2 + Math.random() * 1.8;
    this.color = color;
  }

  update() {
    this.x += this.vx;
    this.y += this.vy;
    this.life -= this.decay;
    return this.life > 0;
  }

  draw(ctx, offsetX, offsetY) {
    ctx.globalAlpha = this.life * 0.9;
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.arc(this.x + offsetX, this.y + offsetY, this.size * this.life, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

function spawnParticles(particles, count, level, boost, color, canvas) {
  const vizSize = canvas.height * 0.75;
  const baseR = vizSize * 0.28;
  const pulse = (level * 0.65 + boost * 0.85);
  const radius = baseR * (1.0 + pulse);
  const speedBase = (1.6 + boost * 4.0 + level * 2.5);

  for (let i = 0; i < count; i++) {
    const ang = Math.random() * Math.PI * 2;
    const jitter = (Math.random() - 0.5) * 6;
    const x = Math.cos(ang) * (radius + jitter);
    const y = Math.sin(ang) * (radius + jitter);
    const speed = speedBase * (0.7 + Math.random() * 0.8);

    particles.push(new Particle(x, y, ang, speed, color));
  }

  // Limitar
  const MAX_PARTICLES = 1200;
  if (particles.length > MAX_PARTICLES) {
    particles.splice(0, particles.length - MAX_PARTICLES);
  }
}

// ==================== UTILIDADES ====================
function sanitizeFilename(name) {
  return name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
}

// ==================== NOTIFICACIONES TOAST ====================
function showToast(type, title, message, autoClose = true) {
  const container = document.getElementById('toastContainer');

  const icons = {
    success: '✓',
    error: '✕',
    warning: '⚠',
    info: 'ℹ'
  };

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <div class="toast-icon">${icons[type] || 'ℹ'}</div>
    <div class="toast-content">
      <div class="toast-title">${title}</div>
      <div class="toast-message">${message}</div>
    </div>
    <button type="button" class="toast-close">×</button>
  `;

  container.appendChild(toast);

  // Agregar event listener al botón de cerrar
  const closeBtn = toast.querySelector('.toast-close');
  closeBtn.addEventListener('click', () => toast.remove());

  if (autoClose) {
    setTimeout(() => {
      toast.style.animation = 'slideIn 0.3s ease reverse';
      setTimeout(() => toast.remove(), 300);
    }, 5000);
  }

  return toast;
}
