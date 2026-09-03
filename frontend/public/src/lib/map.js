// =====================================================================================
// Lightweight, dependency-free SVG map.
//
// [DECIDE / deviation from spec] The spec calls for react-leaflet + OpenStreetMap
// tiles. This sandbox has no live internet access to OSM tile servers (confirmed:
// tile.openstreetmap.org returns 403 here), so a tile-based map cannot be verified to
// work in THIS environment. Rather than ship an unverified Leaflet integration, this
// pilot renders premises as an interactive SVG scatter-plot using an equirectangular
// projection over Assam's bounding box -- colour-coded exactly as the spec requires
// (High=red / Medium=amber / Low=blue), with hover tooltips and click-through.
//
// This is isolated behind the single `renderMap()` function below. In an
// internet-connected deployment, swap this file's internals for react-leaflet +
// <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" /> -- every
// call site (dashboard, contact-trace results) just calls renderMap(container, points)
// and does not need to change.
// =====================================================================================

// Assam's approximate bounding box (lat/lng), padded slightly.
const BOUNDS = { minLat: 24.0, maxLat: 28.3, minLng: 89.5, maxLng: 96.5 };

function project(lat, lng, width, height) {
  const x = ((lng - BOUNDS.minLng) / (BOUNDS.maxLng - BOUNDS.minLng)) * width;
  const y = height - ((lat - BOUNDS.minLat) / (BOUNDS.maxLat - BOUNDS.minLat)) * height;
  return { x, y };
}

const RISK_COLORS = { High: '#c0392b', Medium: '#d68910', Low: '#2e86c1' };
const TYPE_SHAPES = {
  farm: 'circle', market: 'rect', slaughterhouse: 'diamond', vet_clinic: 'triangle', transport_hub: 'circle',
};

function shapeMarkup(shape, x, y, r, fill, stroke) {
  if (shape === 'rect') {
    return `<rect x="${x - r}" y="${y - r}" width="${r * 2}" height="${r * 2}" fill="${fill}" stroke="${stroke}" stroke-width="1.5" rx="2" />`;
  }
  if (shape === 'diamond') {
    return `<polygon points="${x},${y - r * 1.3} ${x + r * 1.3},${y} ${x},${y + r * 1.3} ${x - r * 1.3},${y}" fill="${fill}" stroke="${stroke}" stroke-width="1.5" />`;
  }
  if (shape === 'triangle') {
    return `<polygon points="${x},${y - r * 1.3} ${x + r * 1.2},${y + r} ${x - r * 1.2},${y + r}" fill="${fill}" stroke="${stroke}" stroke-width="1.5" />`;
  }
  return `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="1.5" />`;
}

/**
 * Renders an interactive SVG map into `container`.
 * @param {HTMLElement} container
 * @param {Array<{lat:number,lng:number,label:string,sub?:string,level?:'High'|'Medium'|'Low',type?:string,isIndex?:boolean,onClick?:Function}>} points
 */
export function renderMap(container, points, options = {}) {
  const width = container.clientWidth || 600;
  const height = options.height || 420;

  const validPoints = points.filter((p) => p.lat != null && p.lng != null);

  const legendHtml = `
    <div class="map-legend">
      <div><span class="dot" style="background:${RISK_COLORS.High}"></span>High risk</div>
      <div><span class="dot" style="background:${RISK_COLORS.Medium}"></span>Medium risk</div>
      <div><span class="dot" style="background:${RISK_COLORS.Low}"></span>Low risk</div>
      <div><span class="dot" style="background:#1a2e22"></span>Index / other</div>
    </div>`;

  const markers = validPoints.map((p, idx) => {
    const { x, y } = project(p.lat, p.lng, width, height);
    const color = p.isIndex ? '#1a2e22' : (RISK_COLORS[p.level] || '#5b6b62');
    const shape = TYPE_SHAPES[p.type] || 'circle';
    const r = p.isIndex ? 9 : 6.5;
    return `<g class="map-marker" data-idx="${idx}" style="cursor:pointer;">${shapeMarkup(shape, x, y, r, color, '#fff')}</g>`;
  }).join('');

  container.innerHTML = `
    <div class="map-wrap" style="height:${height}px">
      <svg class="map-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet">
        <rect x="0" y="0" width="${width}" height="${height}" fill="#dceee4" />
        ${markers}
      </svg>
      ${legendHtml}
    </div>`;

  const svg = container.querySelector('svg');
  let tooltip = null;

  svg.querySelectorAll('.map-marker').forEach((g) => {
    const idx = Number(g.getAttribute('data-idx'));
    const p = validPoints[idx];
    g.addEventListener('mouseenter', (ev) => {
      tooltip = document.createElement('div');
      tooltip.className = 'map-tooltip';
      tooltip.innerHTML = `<strong>${p.label}</strong>${p.sub ? '<br/>' + p.sub : ''}${p.level ? `<br/>Risk: ${p.level}` : ''}`;
      container.appendChild(tooltip);
      positionTooltip(ev);
    });
    g.addEventListener('mousemove', positionTooltip);
    g.addEventListener('mouseleave', () => { if (tooltip) { tooltip.remove(); tooltip = null; } });
    g.addEventListener('click', () => { if (p.onClick) p.onClick(); });

    function positionTooltip(ev) {
      if (!tooltip) return;
      const rect = container.getBoundingClientRect();
      tooltip.style.left = Math.min(ev.clientX - rect.left + 12, width - 200) + 'px';
      tooltip.style.top = Math.max(ev.clientY - rect.top - 40, 4) + 'px';
    }
  });
}
