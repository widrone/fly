import * as THREE from 'three';

const FONT = "'Nunito', 'Trebuchet MS', Roboto, system-ui, sans-serif";
const NAVY = '#1f2f5c';
const BLUE = '#4a78f0';

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrap(ctx, text, maxW) {
  const out = [];
  for (const para of String(text).split('\n')) {
    const words = para.split(/\s+/).filter(Boolean);
    let line = '';
    for (const w of words) {
      const t = line ? line + ' ' + w : w;
      if (ctx.measureText(t).width > maxW && line) {
        out.push(line);
        line = w;
      } else line = t;
    }
    out.push(line);
  }
  return out;
}

export function drawCloudIcon(ctx, cx, cy, s, fill) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.arc(cx - s * 0.45, cy + s * 0.1, s * 0.32, 0, Math.PI * 2);
  ctx.arc(cx, cy - s * 0.12, s * 0.42, 0, Math.PI * 2);
  ctx.arc(cx + s * 0.45, cy + s * 0.08, s * 0.33, 0, Math.PI * 2);
  ctx.fill();
  rr(ctx, cx - s * 0.75, cy + s * 0.05, s * 1.5, s * 0.38, s * 0.19);
  ctx.fill();
}

function drawPlaneIcon(ctx, x, y, s, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = color;
  ctx.beginPath();
  // side-view friendly plane pointing right
  ctx.moveTo(-s, -s * 0.12);
  ctx.lineTo(s * 0.8, -s * 0.12);
  ctx.quadraticCurveTo(s * 1.1, 0, s * 0.8, s * 0.12);
  ctx.lineTo(-s, s * 0.12);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-s * 0.1, 0);
  ctx.lineTo(-s * 0.45, s * 0.7);
  ctx.lineTo(-s * 0.15, s * 0.7);
  ctx.lineTo(s * 0.35, 0);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-s * 0.8, 0);
  ctx.lineTo(-s * 1.05, -s * 0.55);
  ctx.lineTo(-s * 0.85, -s * 0.55);
  ctx.lineTo(-s * 0.55, 0);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawStar(ctx, cx, cy, r1, r2, n = 5) {
  ctx.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 ? r2 : r1;
    const a = -Math.PI / 2 + (i * Math.PI) / n;
    ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  ctx.closePath();
}

// A flat, canvas-drawn panel with text and buttons. Buttons are hit-tested by UV.
export class Panel {
  constructor(width, height, { px = 1024, interactive = true, renderer = null } = {}) {
    this.w = width;
    this.h = height;
    this.cw = px;
    this.ch = Math.round((px * height) / width);
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.cw;
    this.canvas.height = this.ch;
    this.ctx = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    if (renderer) this.tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const mat = new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthWrite: false, fog: false, toneMapped: false });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), mat);
    this.mesh.renderOrder = 900;
    this.mesh.userData.panel = this;
    this.interactive = interactive;
    this.rects = [];
    this.hover = -1;
    this.content = null;
  }

  set(content) {
    this.content = content;
    this.hover = -1;
    this.draw();
  }

  setHover(i) {
    if (i === this.hover) return;
    this.hover = i;
    this.draw();
  }

  hit(uv) {
    const x = uv.x * this.cw;
    const y = (1 - uv.y) * this.ch;
    for (let i = 0; i < this.rects.length; i++) {
      const r = this.rects[i];
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return i;
    }
    return -1;
  }

  draw() {
    const c = this.content || {};
    const ctx = this.ctx;
    const W = this.cw;
    const H = this.ch;
    const S = W / 1024; // scale factor relative to the 1024-wide design
    ctx.clearRect(0, 0, W, H);
    this.rects = [];

    // Card
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, 'rgba(255,255,255,0.97)');
    g.addColorStop(1, 'rgba(236,243,255,0.97)');
    ctx.fillStyle = g;
    rr(ctx, 6, 6, W - 12, H - 12, 44 * S);
    ctx.fill();
    ctx.lineWidth = 6 * S;
    ctx.strokeStyle = 'rgba(120,160,255,0.55)';
    ctx.stroke();

    const pad = 52 * S;
    let y = pad;

    // Journey progress
    if (typeof c.progress === 'number') {
      const x0 = pad + 70 * S;
      const x1 = W - pad - 70 * S;
      const py = y + 14 * S;
      ctx.font = `700 ${24 * S}px ${FONT}`;
      ctx.fillStyle = '#7a88aa';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.fillText('Start', pad, py);
      ctx.textAlign = 'right';
      ctx.fillText('Landed', W - pad, py);
      ctx.setLineDash([8 * S, 10 * S]);
      ctx.strokeStyle = '#b8c6e8';
      ctx.lineWidth = 5 * S;
      ctx.beginPath();
      ctx.moveTo(x0, py);
      ctx.lineTo(x1, py);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeStyle = BLUE;
      ctx.beginPath();
      ctx.moveTo(x0, py);
      ctx.lineTo(x0 + (x1 - x0) * c.progress, py);
      ctx.stroke();
      drawPlaneIcon(ctx, x0 + (x1 - x0) * c.progress, py, 22 * S, BLUE);
      y += 52 * S;
    }

    // Buttons layout first so we know how much room text has
    const btns = (c.buttons || []).map(([label, action, style]) => ({ label, action, style }));
    const bh = 92 * S;
    const by = H - pad - bh + 8 * S;
    const hasCalm = c.calm !== false && this.interactive;
    let textBottom = this.interactive && (btns.length || hasCalm) ? by - 24 * S : H - pad;

    // Badge
    if (c.badge) {
      const bx = W - pad - 110 * S;
      const bcy = y + 120 * S;
      ctx.fillStyle = '#ffd54a';
      ctx.strokeStyle = '#e0a400';
      ctx.lineWidth = 6 * S;
      drawStar(ctx, bx, bcy, 100 * S, 46 * S);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#8a5a00';
      ctx.font = `800 ${24 * S}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('BRAVE', bx, bcy - 2 * S);
      ctx.fillText('FLYER', bx, bcy + 24 * S);
    }
    const textRight = c.badge ? W - pad - 230 * S : W - pad;

    // Title
    if (c.title) {
      ctx.fillStyle = NAVY;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      let ts = (c.titleSize || 58) * S;
      ctx.font = `800 ${ts}px ${FONT}`;
      while (ctx.measureText(c.title).width > textRight - pad && ts > 30 * S) {
        ts -= 2 * S;
        ctx.font = `800 ${ts}px ${FONT}`;
      }
      ctx.fillText(c.title, pad, y);
      y += ts * 1.25;
    }

    // Big breathing text
    if (c.big) {
      ctx.fillStyle = BLUE;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `800 ${96 * S}px ${FONT}`;
      const midY = (y + textBottom) / 2 - 20 * S;
      ctx.fillText(c.big, W / 2, midY);
      if (c.count) {
        ctx.font = `700 ${44 * S}px ${FONT}`;
        ctx.fillStyle = '#6b7aa0';
        ctx.fillText(c.count, W / 2, midY + 86 * S);
      }
      if (c.dots) {
        const [done, total] = c.dots;
        if (isFinite(total)) {
          for (let i = 0; i < total; i++) {
            ctx.beginPath();
            ctx.arc(W / 2 + (i - (total - 1) / 2) * 44 * S, midY + 140 * S, 12 * S, 0, Math.PI * 2);
            ctx.fillStyle = i < done ? BLUE : '#c9d5f2';
            ctx.fill();
          }
        }
      }
    } else if (c.text) {
      // Body text, shrinking to fit
      let fs = (c.textSize || 40) * S;
      let lines;
      for (;;) {
        ctx.font = `600 ${fs}px ${FONT}`;
        lines = wrap(ctx, c.text, textRight - pad);
        if (lines.length * fs * 1.32 <= textBottom - y || fs < 22 * S) break;
        fs -= 2 * S;
      }
      ctx.fillStyle = '#34405e';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      lines.forEach((ln, i) => ctx.fillText(ln, pad, y + i * fs * 1.32));
    }

    if (!this.interactive) {
      this.tex.needsUpdate = true;
      return;
    }

    // Calm button (bottom-left)
    if (hasCalm) {
      const r = { x: pad - 8 * S, y: by, w: 196 * S, h: bh, action: 'calm' };
      const i = this.rects.length;
      this.rects.push(r);
      const hov = this.hover === i;
      ctx.fillStyle = hov ? '#e3ecff' : '#f4f7ff';
      rr(ctx, r.x, r.y, r.w, r.h, bh / 2);
      ctx.fill();
      ctx.lineWidth = (c.highlightCalm ? 8 : 4) * S;
      ctx.strokeStyle = c.highlightCalm ? '#ffb300' : '#9fb6f0';
      ctx.stroke();
      drawCloudIcon(ctx, r.x + 56 * S, r.y + bh / 2 - 4 * S, 40 * S, '#7aa2ff');
      ctx.fillStyle = NAVY;
      ctx.font = `800 ${34 * S}px ${FONT}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText('Break', r.x + 100 * S, r.y + bh / 2 + 2 * S);
    }

    // Action buttons (right-aligned)
    if (btns.length) {
      let fs = 38 * S;
      const gap = 22 * S;
      const leftLimit = hasCalm ? pad + 210 * S : pad;
      let widths;
      for (;;) {
        ctx.font = `800 ${fs}px ${FONT}`;
        widths = btns.map((b) => ctx.measureText(b.label).width + 64 * S);
        const tot = widths.reduce((a, b) => a + b, 0) + gap * (btns.length - 1);
        if (tot <= W - pad - leftLimit || fs < 22 * S) break;
        fs -= 2 * S;
      }
      let x = W - pad + 8 * S;
      for (let k = btns.length - 1; k >= 0; k--) {
        const b = btns[k];
        x -= widths[k];
        const r = { x, y: by, w: widths[k], h: bh, action: b.action };
        const i = this.rects.length;
        this.rects.push(r);
        const hov = this.hover === i;
        const primary = b.style !== 'secondary' && k === btns.length - 1;
        const active = b.style === 'active';
        rr(ctx, r.x, r.y, r.w, r.h, bh / 2);
        if (primary || active) {
          ctx.fillStyle = hov ? '#6b92ff' : active ? '#ff9f43' : BLUE;
          ctx.fill();
          ctx.fillStyle = '#fff';
        } else {
          ctx.fillStyle = hov ? '#e3ecff' : '#ffffff';
          ctx.fill();
          ctx.lineWidth = 4 * S;
          ctx.strokeStyle = '#9fb6f0';
          ctx.stroke();
          ctx.fillStyle = NAVY;
        }
        if (hov) {
          ctx.lineWidth = 6 * S;
          ctx.strokeStyle = 'rgba(74,120,240,0.6)';
          rr(ctx, r.x - 4 * S, r.y - 4 * S, r.w + 8 * S, r.h + 8 * S, bh / 2 + 4 * S);
          ctx.stroke();
          ctx.fillStyle = primary || active ? '#fff' : NAVY;
        }
        ctx.font = `800 ${fs}px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(b.label, r.x + r.w / 2, r.y + bh / 2 + 2 * S);
        x -= gap;
      }
    }
    this.tex.needsUpdate = true;
  }
}
