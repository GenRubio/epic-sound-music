# 🎬 Audio Visualizer - Video Manager

Sistema de gestión y generación de videos de visualización de audio con exportación de alta calidad a MP4.

## Características

- **Sin píxeles aleatorios** - Renderizado frame-by-frame determinístico
- **Sincronización perfecta** - Análisis de audio con FFmpeg para detectar bajos
- **Alta calidad MP4** - Codificación H.264 con preset `medium` y CRF 18
- **Optimizado para velocidad** - Multi-threading y procesamiento por lotes
- **Workflow mejorado** - Configura tu contenido y genera el video final
- **Progreso en tiempo real** - Barra de progreso durante la generación
- **60 FPS** - Videos fluidos y profesionales

## Ventajas sobre la versión web

| Versión Web | Versión Electron |
|-------------|-----------------|
| MediaRecorder (grabación en vivo) | Renderizado frame-by-frame |
| Compresión en tiempo real | Sin compresión durante render |
| Artefactos y píxeles aleatorios | Renderizado determinístico perfecto |
| WebM con VP8/VP9 | MP4 con H.264 de alta calidad |
| Sin control de calidad | CRF 18, preset slow, 320k audio |

## Requisitos

- Node.js 16 o superior
- Windows 10/11, macOS, o Linux

## Instalación

```bash
# Instalar dependencias
npm install

# Iniciar la aplicación
npm start
```

El script `postinstall` descargará automáticamente FFmpeg para tu sistema operativo.

## Uso

1. **Cargar Audio**: Haz clic en "📁 Cargar Audio" y selecciona tu archivo MP3/WAV/OGG
2. **Cargar Fondo** (opcional): Haz clic en "🖼️ Cargar Fondo" para añadir una imagen de fondo
3. **Personalizar**:
   - Cambia el color del anillo con el selector de color
   - Edita el texto que aparece a la izquierda
4. **Vista previa**: Usa "▶︎ Play / Pause" para previsualizar
5. **Generar Video**: Haz clic en "🎬 Generar Video MP4"
   - Selecciona dónde guardar el video
   - **Fase 1**: Renderizado de todos los frames (puede tomar varios minutos)
   - **Fase 2**: Codificación con FFmpeg
6. **Espera**: La barra de progreso muestra el avance en tiempo real

## Proceso de generación

### Fase 1: Renderizado (70-80% del tiempo)
- Analiza el audio completo para extraer niveles de bajos
- Renderiza cada frame uno por uno (60 FPS)
- Guarda cada frame como PNG en directorio temporal
- **Tiempo estimado**: ~30-60 segundos por minuto de audio

### Fase 2: Codificación FFmpeg (20-30% del tiempo)
- Combina todos los frames en un video
- Codificación H.264 con calidad constante CRF 18
- Audio AAC 320kbps
- **Tiempo estimado**: ~10-20 segundos por minuto de audio

## Configuración de calidad y velocidad

Puedes ajustar la calidad en [main.js:84-90](main.js#L84-L90):

```javascript
.outputOptions([
  '-preset', 'medium',    // Balance velocidad/calidad
  '-crf', '18',           // 0-51 (menor = mejor calidad, 18 = alta calidad, 23 = default)
  '-pix_fmt', 'yuv420p',
  '-movflags', '+faststart',
  '-threads', '0'         // Usa todos los núcleos de CPU
])
```

### Presets FFmpeg (velocidad vs calidad)

- `ultrafast` - Muy rápido pero baja calidad
- `fast` - Más rápido con buena calidad
- `medium` - **Recomendado** - Balance perfecto entre velocidad y calidad
- `slow` - Más lento pero mejor calidad
- `veryslow` - Máxima calidad pero muy lento

### CRF (Constant Rate Factor)

- `0` - Sin pérdida (archivos enormes)
- `18` - **Recomendado** - Alta calidad visual
- `23` - Default de FFmpeg (buena calidad)
- `28` - Calidad media
- `51` - Peor calidad

## Solución de problemas

### El video tarda mucho en generarse

Es normal. Para un audio de 3 minutos:
- Renderizado: ~1.5-3 minutos
- Codificación: ~30-60 segundos

### Error: "FFmpeg no encontrado"

Ejecuta manualmente:
```bash
npm run postinstall
```

### Los frames ocupan mucho espacio

Los frames temporales se eliminan automáticamente después de la generación. Si el proceso se interrumpe, puedes eliminarlos manualmente de tu carpeta temporal del sistema.

### El video no se sincroniza con el audio

Asegúrate de que el análisis de audio esté completo antes de renderizar. El sistema usa análisis offline para sincronización perfecta.

## Arquitectura técnica

```
┌─────────────┐
│   Renderer  │
│  (index.html)│
│             │
│  - UI       │
│  - Canvas   │
│  - Análisis │
│  - Frames   │
└──────┬──────┘
       │ IPC
       │
┌──────▼──────┐
│    Main     │
│  (main.js)  │
│             │
│  - Diálogos │
│  - FS       │
│  - FFmpeg   │
└──────┬──────┘
       │
       ▼
┌─────────────┐
│   FFmpeg    │
│             │
│  frames +   │
│  audio →    │
│  MP4        │
└─────────────┘
```

##  https://fixthephoto.com/es/photoshop-online.html

## Licencia

MIT
