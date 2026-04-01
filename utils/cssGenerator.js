/**
 * Generate color override CSS for templates.
 */
export function generateColorCSS(accentStart, accentEnd) {
  const as = accentStart || '#ff5858';
  const ae = accentEnd || '#f9a3a3';
  return `<style>
    :root {
      --bg-stop2-color: ${as} !important;
      --bg-stop3-color: ${ae} !important;
      --accent-start: ${as};
      --accent-end: ${ae};
    }
    .frame, .template-bg, .figma-bg {
      background: linear-gradient(180deg, #000 20.715%, ${as} 55.485%, ${ae} 99.469%) !important;
    }
    .title, .template-title, .figma-title {
      background: linear-gradient(90deg, ${as}, ${ae}) !important;
      -webkit-background-clip: text !important;
      background-clip: text !important;
      -webkit-text-fill-color: transparent !important;
    }
    .before-rect, .main-frame, .circle-frame,
    .main-img-frame {
      border-color: ${ae} !important;
    }
    .prompt-rect, .red-bg-bar, .desc-bg {
      background: ${as} !important;
    }
    .swatch-overlay, .main-img-overlay-left {
      background: color-mix(in srgb, ${ae} 26%, transparent) !important;
    }
    .swatch-overlay2, .main-img-overlay-right {
      background: color-mix(in srgb, ${as} 26%, transparent) !important;
    }
    .swatch-center-container {
      border-color: ${ae} !important;
    }
  </style>`;
}

/**
 * Generate text wrap CSS for templates.
 */
export function generateWrapCSS() {
  return `<style>
    .title,.tagline,.template-title {
      white-space:normal!important;
      width:1000px!important;
      max-width:1000px!important;
    }
  </style>`;
}

/**
 * Generate font override CSS.
 */
export function generateFontCSS(fontFamily) {
  if (!fontFamily) return '';
  return `<link href="https://fonts.googleapis.com/css2?family=${encodeURIComponent(fontFamily)}:wght@400;600;700;800&display=swap" rel="stylesheet">
  <style>*{font-family:'${fontFamily}',sans-serif!important;}</style>`;
}
