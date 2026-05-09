/* ═══════════════════════════════════════════════════════════════════════
   AVATAR — text-based half-portrait that reacts to user behavior.

   Initializes after `site:ready` (dispatched by render.js) so the word
   dictionary can come from content/site.json.

   Design notes:
   - Uses Canvas measureText for accurate glyph metrics (production: swap
     in Pretext's `prepare()` for ~500x speed-up + perfect cross-browser).
   - Avatar = collection of "glyphs" placed along a body silhouette path.
   - Each glyph has a target position; we lerp toward it every frame.
   - Different "poses" rebuild the silhouette → glyphs migrate smoothly.
   ═══════════════════════════════════════════════════════════════════════ */

document.addEventListener('site:ready', (e) => {
  const data = e.detail?.avatar;
  if (!data) return;

  const WORDS = data.words || [];
  const HIGHLIGHT_WORDS = new Set(data.highlightWords || []);
  const HEAVY_CHARS = ['█', '▓', '▒', '░', '·', '∙'];

  const canvas = document.getElementById('avatar');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  let DPR = Math.min(2, window.devicePixelRatio || 1);
  let W, H;

  function fitCanvas() {
    const rect = canvas.getBoundingClientRect();
    canvas.width  = rect.width  * DPR;
    canvas.height = rect.height * DPR;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    W = rect.width;
    H = rect.height;
  }

  /* ═══════════════════════════════════════════════════════════════════════
     POSE DEFINITIONS
     Each pose returns an array of {x, y, weight} target positions.
     weight: 0..1 — heavier areas use bigger/darker chars.
     ═══════════════════════════════════════════════════════════════════════ */

  function poseDefault(cx, cy, scale = 1) {
    const pts = [];
    const s = scale;

    const headR = 55 * s;
    const headCy = cy - 60 * s;
    for (let a = 0; a < Math.PI * 2; a += 0.18) {
      pts.push({
        x: cx + Math.cos(a) * headR * 0.95,
        y: headCy + Math.sin(a) * headR,
        weight: 0.4,
      });
    }
    for (let r = 0; r < headR - 8; r += 12) {
      for (let a = 0; a < Math.PI * 2; a += 0.5 / (r/20 + 0.5)) {
        pts.push({
          x: cx + Math.cos(a) * r * 0.95,
          y: headCy + Math.sin(a) * r,
          weight: 0.5 + (1 - r / headR) * 0.3,
        });
      }
    }

    for (let y = headCy + headR * 0.85; y < cy + 5; y += 9) {
      pts.push({ x: cx - 14 * s, y, weight: 0.5 });
      pts.push({ x: cx + 14 * s, y, weight: 0.5 });
    }

    for (let y = cy + 5; y < cy + 130 * s; y += 10) {
      const t = (y - cy - 5) / (130 * s - 5);
      const w = 60 * s + t * 70 * s;
      pts.push({ x: cx - w, y, weight: 0.7 });
      pts.push({ x: cx + w, y, weight: 0.7 });
      for (let xo = -w + 14; xo < w; xo += 16) {
        pts.push({
          x: cx + xo,
          y: y + (Math.random() - 0.5) * 3,
          weight: 0.55 + Math.random() * 0.2,
        });
      }
    }

    return pts;
  }

  function poseWaving(cx, cy, scale = 1) {
    const pts = poseDefault(cx, cy, scale);
    const armBaseX = cx + 90 * scale;
    const armBaseY = cy + 30 * scale;
    for (let t = 0; t < 1; t += 0.06) {
      const ax = armBaseX + 30 * scale * Math.sin(t * Math.PI);
      const ay = armBaseY - 80 * scale * t;
      pts.push({ x: ax, y: ay, weight: 0.7 });
    }
    for (let i = 0; i < 8; i++) {
      pts.push({
        x: armBaseX + 30 * scale * Math.sin(Math.PI) + (i % 4 - 1.5) * 5,
        y: armBaseY - 80 * scale + Math.floor(i / 4) * 5,
        weight: 0.85,
      });
    }
    return pts;
  }

  function poseThinking(cx, cy, scale = 1) {
    const pts = poseDefault(cx, cy, scale);
    const startX = cx + 70 * scale;
    const startY = cy + 40 * scale;
    const endX = cx + 5 * scale;
    const endY = cy - 35 * scale;
    for (let t = 0; t < 1; t += 0.07) {
      const x = startX + (endX - startX) * t;
      const y = startY + (endY - startY) * t - Math.sin(t * Math.PI) * 15;
      pts.push({ x, y, weight: 0.65 });
    }
    return pts;
  }

  function poseStretching(cx, cy, scale = 1) {
    const pts = poseDefault(cx, cy, scale);
    for (let t = 0; t < 1; t += 0.08) {
      pts.push({
        x: cx - 80 * scale - t * 20 * scale,
        y: cy + 10 * scale - t * 90 * scale,
        weight: 0.65,
      });
    }
    for (let t = 0; t < 1; t += 0.08) {
      pts.push({
        x: cx + 80 * scale + t * 20 * scale,
        y: cy + 10 * scale - t * 90 * scale,
        weight: 0.65,
      });
    }
    return pts;
  }

  function posePresenting(cx, cy, scale = 1) {
    const pts = poseDefault(cx, cy, scale);
    for (let t = 0; t < 1; t += 0.07) {
      pts.push({
        x: cx - 80 * scale - t * 60 * scale,
        y: cy + 30 * scale - t * 5 * scale,
        weight: 0.65,
      });
    }
    return pts;
  }

  function poseFarewell(cx, cy, scale = 1) {
    const pts = [];
    const s = scale;
    const headR = 55 * s;
    const headCy = cy - 50 * s;
    for (let a = 0; a < Math.PI * 2; a += 0.18) {
      pts.push({
        x: cx + Math.cos(a) * headR * 0.95,
        y: headCy + Math.sin(a) * headR,
        weight: 0.4,
      });
    }
    for (let r = 0; r < headR - 8; r += 12) {
      for (let a = 0; a < Math.PI * 2; a += 0.5 / (r/20 + 0.5)) {
        pts.push({
          x: cx + Math.cos(a) * r * 0.95,
          y: headCy + Math.sin(a) * r,
          weight: 0.5,
        });
      }
    }
    for (let y = headCy + headR * 0.85; y < cy + 130 * s; y += 10) {
      const t = (y - headCy - headR * 0.85) / (cy + 130 * s - headCy - headR * 0.85);
      const w = 25 * s + t * 100 * s;
      pts.push({ x: cx - w, y, weight: 0.7 });
      pts.push({ x: cx + w, y, weight: 0.7 });
      for (let xo = -w + 14; xo < w; xo += 16) {
        pts.push({ x: cx + xo, y, weight: 0.55 });
      }
    }
    for (let i = 0; i < 6; i++) {
      pts.push({ x: cx - 10 + i * 4, y: cy + 30, weight: 0.75 });
    }
    return pts;
  }

  const POSES = {
    default:    poseDefault,
    wave:       poseWaving,
    thinking:   poseThinking,
    stretch:    poseStretching,
    present:    posePresenting,
    farewell:   poseFarewell,
  };

  /* ═══════════════════════════════════════════════════════════════════════
     GLYPH SYSTEM
     ═══════════════════════════════════════════════════════════════════════ */

  class Glyph {
    constructor(text, x, y, weight) {
      this.text = text;
      this.x = x;
      this.y = y;
      this.tx = x;
      this.ty = y;
      this.weight = weight;
      this.tWeight = weight;
      this.alpha = 0;
      this.targetAlpha = 0.7 + weight * 0.3;
      this.phase = Math.random() * Math.PI * 2;
    }

    setTarget(tx, ty, weight) {
      this.tx = tx;
      this.ty = ty;
      this.tWeight = weight;
    }

    update(dt, breath, headOffset) {
      const k = 0.08;
      this.x += (this.tx - this.x) * k;
      this.y += (this.ty - this.y) * k;
      this.weight += (this.tWeight - this.weight) * k;
      this.alpha += (this.targetAlpha - this.alpha) * 0.1;

      this.phase += dt * 0.001;
      this._drawX = this.x + Math.sin(this.phase) * 0.4;
      this._drawY = this.y + Math.cos(this.phase * 0.7) * 0.4 + breath;
      if (this.y < (avatar.cy - 30)) {
        this._drawX += headOffset.x;
        this._drawY += headOffset.y;
      }
    }

    draw(ctx) {
      if (this.alpha < 0.02) return;
      ctx.globalAlpha = this.alpha;
      const fontSize = 8 + this.weight * 5;
      ctx.font = `${fontSize}px 'JetBrains Mono', monospace`;
      const isHighlight = HIGHLIGHT_WORDS.has(this.text);
      ctx.fillStyle = isHighlight ? '#ff5b1f' : '#e8e8ec';
      ctx.fillText(this.text, this._drawX ?? this.x, this._drawY ?? this.y);
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════
     AVATAR CONTROLLER
     ═══════════════════════════════════════════════════════════════════════ */

  const avatar = {
    cx: 0, cy: 0,
    glyphs: [],
    currentPose: 'default',
    targetPose: 'default',
    poseEndsAt: 0,
    lookOffset: { x: 0, y: 0 },
    targetLook: { x: 0, y: 0 },
    breathPhase: 0,
    blinkCloseUntil: 0,
    lastIdleAction: 0,
    scale: 1,
  };

  function initGlyphs() {
    fitCanvas();
    avatar.cx = W * 0.5;
    avatar.cy = H * 0.55;
    avatar.scale = Math.min(W / 320, H / 360);

    const targets = POSES.default(avatar.cx, avatar.cy, avatar.scale);
    avatar.glyphs = targets.map((t, i) => {
      const word = pickWord(t.weight, i);
      return new Glyph(word, t.x, t.y, t.weight);
    });
  }

  function pickWord(weight, idx) {
    if (weight > 0.78) return HEAVY_CHARS[idx % HEAVY_CHARS.length];
    if (weight > 0.55) return Math.random() < 0.4 ? HEAVY_CHARS[idx % HEAVY_CHARS.length] : WORDS[idx % WORDS.length];
    return WORDS[idx % WORDS.length];
  }

  function applyPose(name, options = {}) {
    const fn = POSES[name];
    if (!fn) return;
    const targets = fn(avatar.cx, avatar.cy, avatar.scale);

    for (let i = 0; i < avatar.glyphs.length; i++) {
      if (i < targets.length) {
        avatar.glyphs[i].setTarget(targets[i].x, targets[i].y, targets[i].weight);
        avatar.glyphs[i].targetAlpha = 0.7 + targets[i].weight * 0.3;
      } else {
        avatar.glyphs[i].targetAlpha = 0;
      }
    }
    for (let i = avatar.glyphs.length; i < targets.length; i++) {
      const t = targets[i];
      const g = new Glyph(pickWord(t.weight, i), avatar.cx, avatar.cy, t.weight);
      g.setTarget(t.x, t.y, t.weight);
      g.alpha = 0;
      g.targetAlpha = 0.7 + t.weight * 0.3;
      avatar.glyphs.push(g);
    }

    avatar.currentPose = name;
    if (options.duration) {
      avatar.poseEndsAt = performance.now() + options.duration;
    } else {
      avatar.poseEndsAt = 0;
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════
     INTERACTION HOOKS
     ═══════════════════════════════════════════════════════════════════════ */

  let mouseX = 0, mouseY = 0;
  document.addEventListener('mousemove', (ev) => {
    mouseX = ev.clientX;
    mouseY = ev.clientY;
  });

  canvas.addEventListener('click', () => {
    applyPose('wave', { duration: 1500 });
    flashMessage("hi there 👋");
  });

  let lastSection = 'about';
  function checkSection() {
    const sections = document.querySelectorAll('.section[data-section]');
    let current = lastSection;
    const mid = window.innerHeight / 2;
    sections.forEach(s => {
      const r = s.getBoundingClientRect();
      if (r.top < mid && r.bottom > mid) {
        current = s.dataset.section;
      }
    });
    if (current !== lastSection) {
      lastSection = current;
      onSectionChange(current);
    }
  }

  function onSectionChange(sec) {
    if (avatar.poseEndsAt > performance.now()) return;
    if (sec === 'about')   applyPose('default');
    if (sec === 'cases')   applyPose('present');
    if (sec === 'lens')    applyPose('thinking');
    if (sec === 'contact') applyPose('farewell');
  }
  window.addEventListener('scroll', checkSection, { passive: true });

  const msgInput = document.getElementById('message-input');
  let typingTimer;
  if (msgInput) {
    msgInput.addEventListener('input', () => {
      applyPose('thinking', { duration: 99999 });
      clearTimeout(typingTimer);
      typingTimer = setTimeout(() => {
        avatar.poseEndsAt = performance.now();
        onSectionChange(lastSection);
      }, 1500);
    });
  }

  function scheduleIdle() {
    const delay = 8000 + Math.random() * 12000;
    setTimeout(() => {
      if (avatar.poseEndsAt < performance.now() && avatar.currentPose === 'default') {
        const idleActs = ['stretch', 'thinking'];
        const act = idleActs[Math.floor(Math.random() * idleActs.length)];
        applyPose(act, { duration: 1800 });
      }
      scheduleIdle();
    }, delay);
  }
  scheduleIdle();

  function scheduleBlink() {
    setTimeout(() => {
      avatar.blinkCloseUntil = performance.now() + 120;
      scheduleBlink();
    }, 3000 + Math.random() * 4000);
  }
  scheduleBlink();

  /* ═══════════════════════════════════════════════════════════════════════
     FLASH MESSAGE — small text bubble next to avatar
     ═══════════════════════════════════════════════════════════════════════ */
  let flashText = '', flashUntil = 0;
  function flashMessage(t) {
    flashText = t;
    flashUntil = performance.now() + 1800;
  }

  /* ═══════════════════════════════════════════════════════════════════════
     MAIN LOOP
     ═══════════════════════════════════════════════════════════════════════ */

  let lastTime = 0;
  function loop(t) {
    const dt = t - lastTime;
    lastTime = t;

    ctx.clearRect(0, 0, W, H);

    const rect = canvas.getBoundingClientRect();
    const cxAbs = rect.left + W * 0.5;
    const cyAbs = rect.top + avatar.cy - 60;
    const dx = mouseX - cxAbs;
    const dy = mouseY - cyAbs;
    const dist = Math.hypot(dx, dy) || 1;
    const maxLook = 8;
    avatar.targetLook.x = (dx / dist) * Math.min(maxLook, dist / 80);
    avatar.targetLook.y = (dy / dist) * Math.min(maxLook, dist / 80);
    avatar.lookOffset.x += (avatar.targetLook.x - avatar.lookOffset.x) * 0.08;
    avatar.lookOffset.y += (avatar.targetLook.y - avatar.lookOffset.y) * 0.08;

    avatar.breathPhase += dt * 0.0015;
    const breath = Math.sin(avatar.breathPhase) * 1.5;

    if (avatar.poseEndsAt > 0 && t > avatar.poseEndsAt) {
      avatar.poseEndsAt = 0;
      onSectionChange(lastSection);
    }

    for (const g of avatar.glyphs) {
      g.update(dt, breath, avatar.lookOffset);
      g.draw(ctx);
    }

    ctx.globalAlpha = 1;
    if (t > avatar.blinkCloseUntil) {
      const eyeY = avatar.cy - 70 + avatar.lookOffset.y * 0.5;
      ctx.fillStyle = '#ff5b1f';
      ctx.beginPath();
      ctx.arc(avatar.cx - 14 + avatar.lookOffset.x * 0.6, eyeY, 1.8, 0, Math.PI * 2);
      ctx.arc(avatar.cx + 14 + avatar.lookOffset.x * 0.6, eyeY, 1.8, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.strokeStyle = '#ff5b1f';
      ctx.lineWidth = 1.4;
      const eyeY = avatar.cy - 70;
      ctx.beginPath();
      ctx.moveTo(avatar.cx - 18, eyeY); ctx.lineTo(avatar.cx - 10, eyeY);
      ctx.moveTo(avatar.cx + 10, eyeY); ctx.lineTo(avatar.cx + 18, eyeY);
      ctx.stroke();
    }

    if (t < flashUntil && flashText) {
      const a = Math.min(1, (flashUntil - t) / 600);
      ctx.globalAlpha = a;
      ctx.font = "13px 'JetBrains Mono', monospace";
      ctx.fillStyle = '#ff5b1f';
      ctx.fillText(flashText, avatar.cx + 70, avatar.cy - 90);
    }

    ctx.globalAlpha = 1;
    requestAnimationFrame(loop);
  }

  window.addEventListener('resize', () => {
    initGlyphs();
  });

  initGlyphs();
  requestAnimationFrame(loop);
});
