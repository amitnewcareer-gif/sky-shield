(() => {
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");

  const scoreEl = document.getElementById("score");
  const missesEl = document.getElementById("misses");
  const comboEl = document.getElementById("combo");

  const startBtn = document.getElementById("startBtn");
  const pauseBtn = document.getElementById("pauseBtn");
  const muteBtn = document.getElementById("muteBtn");
  const difficultySel = document.getElementById("difficulty");

  const overlay = document.getElementById("overlay");
  const overlayTitle = document.getElementById("overlayTitle");
  const overlayText = document.getElementById("overlayText");
  const overlayBtn = document.getElementById("overlayBtn");
  const overlayClose = document.getElementById("overlayClose");

  // --- Resize ---
  function resize() {
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
    canvas.style.width = window.innerWidth + "px";
    canvas.style.height = window.innerHeight + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener("resize", resize);
  resize();

  // --- Audio ---
  let muted = true;
  let audioCtx = null;
  function beep(freq = 520, dur = 0.06, type = "sine", gain = 0.03) {
    if (muted) return;
    try {
      audioCtx ??= new (window.AudioContext || window.webkitAudioContext)();
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = type;
      o.frequency.value = freq;
      g.gain.value = gain;
      o.connect(g).connect(audioCtx.destination);
      o.start();
      o.stop(audioCtx.currentTime + dur);
    } catch {}
  }
  muteBtn.addEventListener("click", () => {
    muted = !muted;
    muteBtn.textContent = muted ? "🔇" : "🔊";
    if (!muted) beep(660, 0.05, "triangle", 0.03);
  });

  // --- Helpers ---
  function rand(min, max) { return min + Math.random() * (max - min); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function dist(ax, ay, bx, by) { return Math.hypot(ax - bx, ay - by); }

  // --- Game State ---
  const state = {
    running: false,
    paused: false,
    calmMode: false,

    score: 0,
    combo: 1,
    comboTimer: 0,

    buildingsHit: 0,
    maxBuildingsHit: 10,

    winScore: 100,

    time: 0,
    lastSpawn: 0,
    spawnInterval: 1.0,
  };

  const settingsByDifficulty = {
    easy:   { spawn: 1.15, speed: 0.80, jitter: 0.18 },
    normal: { spawn: 0.90, speed: 1.00, jitter: 0.25 },
    hard:   { spawn: 0.65, speed: 1.20, jitter: 0.32 },
  };
  function currentSettings() {
    const s = settingsByDifficulty[difficultySel.value] || settingsByDifficulty.normal;
    if (state.calmMode) return { spawn: s.spawn * 1.35, speed: s.speed * 0.85, jitter: s.jitter * 0.80 };
    return s;
  }

  // --- Player ---
  const player = {
    x: () => window.innerWidth / 2,
    y: () => window.innerHeight - 70,
    aimX: window.innerWidth / 2,
    aimY: window.innerHeight / 2,
    cooldown: 0,
  };

  // --- Assets (flags as images) ---
  const flagImages = {
    north: new Image(),
    east: new Image(),
    southwest: new Image(),
  };
  // Put your real images here: assets/north.png, assets/east.png, assets/southwest.png
  flagImages.north.src = "assets/north.png";
  flagImages.east.src = "assets/east.png";
  flagImages.southwest.src = "assets/southwest.png";

  // --- Threat sources (neutral by direction) ---
  // You can rename these labels locally if you want, but the game mechanics stay the same.
  const sources = [
    { key: "north",     label: "צפון",     edge: "top",   hue: 330, img: flagImages.north },
    { key: "east",      label: "מזרח",     edge: "right", hue: 210, img: flagImages.east },
    { key: "southwest", label: "דרום־מערב", edge: "left", hue: 120, img: flagImages.southwest },
  ];

  // --- World objects ---
  const missiles = [];
  const particles = [];
  const stars = [];
  const buildings = [];

  function initStars() {
    stars.length = 0;
    const n = Math.floor((window.innerWidth * window.innerHeight) / 18000);
    for (let i = 0; i < n; i++) {
      stars.push({
        x: Math.random() * window.innerWidth,
        y: Math.random() * window.innerHeight,
        r: rand(0.6, 1.8),
        a: rand(0.25, 0.9),
        tw: rand(0.6, 1.7),
      });
    }
  }

  function initBuildings() {
    buildings.length = 0;
    const w = window.innerWidth;
    const groundH = 120;
    const baseY = window.innerHeight - groundH;

    const count = 10;
    const gap = 10;
    const totalGap = gap * (count + 1);
    const bw = Math.max(38, Math.floor((w - totalGap) / count));
    for (let i = 0; i < count; i++) {
      const x = gap + i * (bw + gap);
      const h = rand(55, 105);
      buildings.push({
        id: i,
        x,
        y: baseY - h,
        w: bw,
        h,
        alive: true,
        fade: 0, // for rubble fade
      });
    }
  }

  window.addEventListener("resize", () => {
    initStars();
    initBuildings();
  });

  initStars();
  initBuildings();

  // --- UI ---
  function updateUI() {
    scoreEl.textContent = String(state.score);
    comboEl.textContent = "x" + String(state.combo);
    missesEl.textContent = String(state.buildingsHit);
  }

  function showOverlay(title, text, btnText = "שחק") {
    overlayTitle.textContent = title;
    overlayText.textContent = text;
    overlayBtn.textContent = btnText;
    overlay.classList.remove("hidden");
  }
  function hideOverlay() { overlay.classList.add("hidden"); }

  overlayBtn.addEventListener("click", () => { hideOverlay(); startGame(); });
  overlayClose.addEventListener("click", hideOverlay);

  startBtn.addEventListener("click", startGame);
  pauseBtn.addEventListener("click", togglePause);

  function togglePause() {
    if (!state.running) return;
    state.paused = !state.paused;
    pauseBtn.textContent = state.paused ? "Resume" : "Pause";
  }

  function toggleCalmMode() {
    state.calmMode = !state.calmMode;
    particles.push({ type: "toast", text: state.calmMode ? "מצב רגוע הופעל" : "מצב רגוע כובה", t: 1.1 });
  }

  window.addEventListener("keydown", (e) => {
    if (e.code === "Space") { e.preventDefault(); shoot(); }
    if (e.key.toLowerCase() === "p") togglePause();
    if (e.key.toLowerCase() === "c") toggleCalmMode();
  });

  // --- Aim / input ---
  function setAim(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    player.aimX = clientX - rect.left;
    player.aimY = clientY - rect.top;
    player.aimY = clamp(player.aimY, 40, window.innerHeight - 160);
  }
  window.addEventListener("mousemove", (e) => setAim(e.clientX, e.clientY));
  window.addEventListener("mousedown", (e) => { if (e.button === 0) shoot(); });

  window.addEventListener("touchstart", (e) => {
    const t = e.touches[0];
    if (t) setAim(t.clientX, t.clientY);
    shoot();
  }, { passive: true });

  window.addEventListener("touchmove", (e) => {
    const t = e.touches[0];
    if (t) setAim(t.clientX, t.clientY);
  }, { passive: true });

  // --- Spawning ---
  function pickAliveBuilding() {
    const alive = buildings.filter(b => b.alive);
    if (alive.length === 0) return null;
    return alive[Math.floor(Math.random() * alive.length)];
  }

  function spawnMissile() {
    const s = currentSettings();
    const w = window.innerWidth;
    const h = window.innerHeight;

    // choose source
    const rPick = Math.random();
    const src = rPick < 0.42 ? sources[0] : (rPick < 0.80 ? sources[1] : sources[2]);

    // missile size determines points: small=10, big=5
    const radius = rand(10, 28); // smaller -> harder
    const isSmall = radius <= 16;
    const worth = isSmall ? 10 : 5;

    // target an alive building
    const b = pickAliveBuilding();
    if (!b) return;

    const tx = b.x + b.w / 2 + rand(-10, 10) * s.jitter;
    const ty = b.y + rand(6, 14);

    let x, y;
    if (src.edge === "top") {
      x = rand(60, w - 60);
      y = -80;
    } else if (src.edge === "right") {
      x = w + 80;
      y = rand(40, h * 0.55);
    } else { // left
      x = -80;
      y = rand(40, h * 0.55);
    }

    const dx = tx - x;
    const dy = ty - y;
    const len = Math.max(1, Math.hypot(dx, dy));
    const baseSpeed = (160 + (isSmall ? 160 : 90)) * s.speed;
    const vx = (dx / len) * baseSpeed;
    const vy = (dy / len) * baseSpeed;

    missiles.push({
      x, y, vx, vy,
      r: radius,
      alive: true,
      src,
      worth,
      isSmall,
      targetBuildingId: b.id,
      trail: [],
      wob: rand(0.8, 1.6),
      wobPhase: rand(0, Math.PI * 2),
    });
  }

  // --- Shooting ---
  function shoot() {
    if (!state.running || state.paused) return;
    if (player.cooldown > 0) return;
    player.cooldown = 0.12;

    const sx = player.x();
    const sy = player.y();
    const ex = player.aimX;
    const ey = player.aimY;

    particles.push({ type: "laser", x1: sx, y1: sy, x2: ex, y2: ey, t: 0.07 });

    let hit = null;
    let bestD = Infinity;
    for (const m of missiles) {
      if (!m.alive) continue;
      const d = dist(ex, ey, m.x, m.y);
      if (d < m.r * 1.1 && d < bestD) { bestD = d; hit = m; }
    }

    if (hit) {
      hit.alive = false;

      state.combo = clamp(state.combo + 1, 1, 12);
      state.comboTimer = 1.2;

      state.score += hit.worth;

      // floating score
      particles.push({ type: "scorePop", x: hit.x, y: hit.y, text: `+${hit.worth}`, t: 0.9 });

      // explosion
      for (let i = 0; i < 26; i++) {
        const ang = rand(0, Math.PI * 2);
        const sp = rand(90, 330);
        particles.push({
          type: "spark",
          x: hit.x, y: hit.y,
          vx: Math.cos(ang) * sp,
          vy: Math.sin(ang) * sp,
          r: rand(1.2, 3.0),
          t: rand(0.35, 0.75),
          hue: hit.src.hue,
        });
      }

      beep(760, 0.05, "triangle", 0.03);
      beep(980, 0.04, "sine", 0.02);

      if (state.score >= state.winScore) {
        winGame();
      }
    } else {
      state.combo = 1;
      state.comboTimer = 0;
      beep(220, 0.06, "sine", 0.02);
    }

    updateUI();
  }

  function winGame() {
    state.running = false;
    showOverlay("ניצחתם! 🎉", `הגעתם ל-${state.winScore} נקודות!\nרוצים עוד סיבוב?`, "עוד סיבוב");
  }

  function loseGame() {
    state.running = false;
    showOverlay("נגמר הסבב", `נפגעו 10 בניינים.\nהניקוד שלכם: ${state.score}\nרוצים לנסות שוב?`, "עוד סיבוב");
  }

  // --- Missile hits building ---
  function hitBuilding(m, b) {
    if (!b || !b.alive) return;

    b.alive = false;
    b.fade = 1.0;

    state.buildingsHit += 1;
    state.combo = 1;
    state.comboTimer = 0;
    updateUI();

    // screen hit effect
    particles.push({ type: "hitFlash", t: 0.35 });

    // building explosion
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    for (let i = 0; i < 40; i++) {
      const ang = rand(0, Math.PI * 2);
      const sp = rand(120, 420);
      particles.push({
        type: "spark",
        x: cx, y: cy,
        vx: Math.cos(ang) * sp,
        vy: Math.sin(ang) * sp,
        r: rand(1.4, 3.4),
        t: rand(0.45, 0.95),
        hue: 20,
      });
    }

    beep(160, 0.08, "sine", 0.03);

    if (state.buildingsHit >= state.maxBuildingsHit) loseGame();
  }

  // --- Start/Reset ---
  function resetGame() {
    state.score = 0;
    state.combo = 1;
    state.comboTimer = 0;
    state.buildingsHit = 0;

    state.time = 0;
    state.lastSpawn = 0;

    missiles.length = 0;
    particles.length = 0;

    initBuildings();
    updateUI();
  }

  function startGame() {
    resetGame();
    state.running = true;
    state.paused = false;
    pauseBtn.textContent = "Pause";
  }

  // --- Loop ---
  let last = performance.now();
  function tick(now) {
    requestAnimationFrame(tick);
    const dt = Math.min(0.033, (now - last) / 1000);
    last = now;

    drawBackground();

    if (!state.running) {
      drawBuildings();
      drawWeaponHandsShield();
      drawCrosshair();
      drawHUDTargets();
      return;
    }

    if (state.paused) {
      drawBuildings();
      drawMissiles();
      drawParticles();
      drawWeaponHandsShield();
      drawCrosshair();
      drawPaused();
      drawHUDTargets();
      return;
    }

    update(dt);
    draw();
  }
  requestAnimationFrame(tick);

  function update(dt) {
    state.time += dt;

    const s = currentSettings();
    const ramp = clamp(1 - state.time / 90, 0.35, 1);
    state.spawnInterval = s.spawn * ramp;

    state.lastSpawn += dt;
    if (state.lastSpawn >= state.spawnInterval) {
      state.lastSpawn = 0;
      spawnMissile();
    }

    player.cooldown = Math.max(0, player.cooldown - dt);

    if (state.comboTimer > 0) {
      state.comboTimer -= dt;
      if (state.comboTimer <= 0) state.combo = 1;
    }

    // missiles
    for (const m of missiles) {
      if (!m.alive) continue;

      m.wobPhase += dt * m.wob;
      const wob = Math.sin(m.wobPhase) * 14;

      m.x += m.vx * dt + (m.vy * dt) * 0.03 * wob / 10;
      m.y += m.vy * dt + (m.vx * dt) * -0.03 * wob / 10;

      m.trail.push({ x: m.x, y: m.y });
      if (m.trail.length > 16) m.trail.shift();

      // if close to its target building area -> hit building
      const b = buildings.find(bb => bb.id === m.targetBuildingId);
      if (b && b.alive) {
        const tx = b.x + b.w / 2;
        const ty = b.y + 10;
        if (dist(m.x, m.y, tx, ty) < Math.max(12, m.r * 0.9)) {
          m.alive = false;
          hitBuilding(m, b);
        }
      }

      // cleanup out of bounds
      const w = window.innerWidth, h = window.innerHeight;
      if (m.x < -220 || m.x > w + 220 || m.y < -260 || m.y > h + 260) m.alive = false;
    }

    // particles + rubble fade
    for (const p of particles) {
      p.t -= dt;
      if (p.type === "spark") {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vx *= 0.96;
        p.vy *= 0.96;
      }
      if (p.type === "scorePop") {
        p.y -= 30 * dt;
      }
    }
    for (const b of buildings) {
      if (!b.alive && b.fade > 0) b.fade = Math.max(0, b.fade - dt * 0.35);
    }

    // remove dead
    for (let i = missiles.length - 1; i >= 0; i--) if (!missiles[i].alive) missiles.splice(i, 1);
    for (let i = particles.length - 1; i >= 0; i--) if (particles[i].t <= 0) particles.splice(i, 1);
  }

  // --- Draw ---
  function draw() {
    drawBuildings();
    drawMissiles();
    drawParticles();
    drawWeaponHandsShield();
    drawCrosshair();
    drawHUDTargets();
  }

  function drawBackground() {
    const w = window.innerWidth, h = window.innerHeight;

    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "#061226");
    g.addColorStop(0.58, "#071a35");
    g.addColorStop(1, "#031022");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    // glow
    ctx.save();
    ctx.globalAlpha = 0.22;
    const hg = ctx.createRadialGradient(w/2, h, 60, w/2, h, Math.max(w, h));
    hg.addColorStop(0, "rgba(167,139,250,0.24)");
    hg.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = hg;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();

    // stars
    for (const s of stars) {
      s.a += (Math.sin((performance.now()/1000) * s.tw) * 0.002);
      const a = clamp(s.a, 0.15, 0.95);
      ctx.globalAlpha = a;
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // ground strip
    ctx.save();
    ctx.globalAlpha = 0.20;
    ctx.fillStyle = "rgba(0,0,0,1)";
    ctx.fillRect(0, h - 120, w, 120);
    ctx.restore();
  }

  function drawBuildings() {
    for (const b of buildings) {
      if (b.alive) {
        // building body
        ctx.save();
        ctx.fillStyle = "rgba(234,241,255,0.10)";
        ctx.strokeStyle = "rgba(255,255,255,0.10)";
        ctx.lineWidth = 1;
        roundRect(b.x, b.y, b.w, b.h, 8);
        ctx.fill();
        ctx.stroke();

        // windows
        ctx.fillStyle = "rgba(125,211,252,0.20)";
        const rows = Math.floor(b.h / 18);
        const cols = Math.max(2, Math.floor(b.w / 16));
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            if (Math.random() < 0.35) continue;
            const wx = b.x + 6 + c * (b.w - 12) / cols;
            const wy = b.y + 8 + r * (b.h - 14) / rows;
            ctx.fillRect(wx, wy, 6, 9);
          }
        }
        ctx.restore();
      } else if (b.fade > 0) {
        // rubble fade
        ctx.save();
        ctx.globalAlpha = 0.35 * b.fade;
        ctx.fillStyle = "rgba(251,113,133,1)";
        ctx.fillRect(b.x, b.y + b.h - 10, b.w, 10);
        ctx.restore();
      }
    }
  }

  function drawMissiles() {
    for (const m of missiles) {
      // trail
      ctx.save();
      for (let i = 0; i < m.trail.length - 1; i++) {
        const a = i / m.trail.length;
        ctx.globalAlpha = 0.08 + a * 0.20;
        ctx.strokeStyle = `hsla(${m.src.hue}, 90%, 70%, 1)`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(m.trail[i].x, m.trail[i].y);
        ctx.lineTo(m.trail[i+1].x, m.trail[i+1].y);
        ctx.stroke();
      }
      ctx.restore();

      // body
      ctx.save();
      ctx.translate(m.x, m.y);
      const ang = Math.atan2(m.vy, m.vx) + Math.PI / 2;
      ctx.rotate(ang);

      const r = m.r;

      ctx.globalAlpha = 0.22;
      ctx.fillStyle = `hsla(${m.src.hue}, 90%, 60%, 1)`;
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 0.95, r * 1.10, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.globalAlpha = 1;
      ctx.fillStyle = "rgba(255,255,255,0.92)";
      ctx.strokeStyle = `hsla(${m.src.hue}, 90%, 58%, 1)`;
      ctx.lineWidth = 2;

      ctx.beginPath();
      ctx.moveTo(0, -r * 1.35);
      ctx.quadraticCurveTo(r * 0.62, -r * 0.95, r * 0.52, 0);
      ctx.quadraticCurveTo(r * 0.40, r * 1.10, 0, r * 1.05);
      ctx.quadraticCurveTo(-r * 0.40, r * 1.10, -r * 0.52, 0);
      ctx.quadraticCurveTo(-r * 0.62, -r * 0.95, 0, -r * 1.35);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // badge + flag image
      ctx.fillStyle = `hsla(${m.src.hue}, 80%, 55%, 1)`;
      ctx.beginPath();
      ctx.arc(0, -r * 0.10, r * 0.55, 0, Math.PI * 2);
      ctx.fill();

      // draw flag image if loaded; else fallback dot
      const img = m.src.img;
      if (img && img.complete && img.naturalWidth > 0) {
        const s = Math.max(14, Math.floor(r * 1.2));
        ctx.save();
        ctx.globalAlpha = 0.95;
        ctx.drawImage(img, -s/2, -r*0.10 - s/2, s, s);
        ctx.restore();
      } else {
        ctx.fillStyle = "rgba(0,0,0,0.55)";
        ctx.beginPath();
        ctx.arc(0, -r * 0.10, r * 0.18, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
    }
  }

  function drawParticles() {
    for (const p of particles) {
      if (p.type === "laser") {
        ctx.save();
        ctx.globalAlpha = clamp(p.t / 0.07, 0, 1);
        ctx.strokeStyle = "rgba(125,211,252,0.9)";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(p.x1, p.y1);
        ctx.lineTo(p.x2, p.y2);
        ctx.stroke();

        ctx.globalAlpha *= 0.55;
        ctx.strokeStyle = "rgba(167,139,250,0.9)";
        ctx.lineWidth = 7;
        ctx.beginPath();
        ctx.moveTo(p.x1, p.y1);
        ctx.lineTo(p.x2, p.y2);
        ctx.stroke();
        ctx.restore();
      } else if (p.type === "spark") {
        ctx.save();
        const a = clamp(p.t / 0.95, 0, 1);
        ctx.globalAlpha = 0.9 * a;
        ctx.fillStyle = `hsla(${p.hue}, 90%, 65%, 1)`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      } else if (p.type === "hitFlash") {
        ctx.save();
        const a = clamp(p.t / 0.35, 0, 1);
        ctx.globalAlpha = 0.55 * a;
        ctx.fillStyle = "rgba(255,0,0,1)";
        ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);
        ctx.restore();
      } else if (p.type === "scorePop") {
        ctx.save();
        const a = clamp(p.t / 0.9, 0, 1);
        ctx.globalAlpha = 0.95 * a;
        ctx.fillStyle = "rgba(234,241,255,0.95)";
        ctx.strokeStyle = "rgba(0,0,0,0.35)";
        ctx.lineWidth = 3;
        ctx.font = "900 18px system-ui";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.strokeText(p.text, p.x, p.y);
        ctx.fillText(p.text, p.x, p.y);
        ctx.restore();
      } else if (p.type === "toast") {
        ctx.save();
        const a = clamp(p.t / 1.1, 0, 1);
        ctx.globalAlpha = 0.85 * a;
        const w = window.innerWidth;
        ctx.fillStyle = "rgba(8,20,39,0.75)";
        ctx.strokeStyle = "rgba(255,255,255,0.12)";
        ctx.lineWidth = 1;
        const text = p.text;
        ctx.font = "700 14px system-ui";
        const tw = ctx.measureText(text).width;
        const pad = 12;
        const x = (w - (tw + pad * 2)) / 2;
        const y = 74;
        roundRect(x, y, tw + pad * 2, 36, 12);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "rgba(234,241,255,0.92)";
        ctx.textBaseline = "middle";
        ctx.fillText(text, x + pad, y + 18);
        ctx.restore();
      }
    }
  }

  // ✅ Weapon redesign: hands + shield emitter (non-phallic)
  function drawWeaponHandsShield() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const cx = player.x();
    const cy = player.y();

    ctx.save();
    ctx.globalAlpha = 0.95;

    // arm pad shadow
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    roundRect(cx - 260, h - 135, 520, 155, 44);
    ctx.fill();

    // hands blocks
    ctx.fillStyle = "rgba(255, 227, 199, 0.95)";
    roundRect(cx - 185, h - 125, 160, 100, 36);
    ctx.fill();
    roundRect(cx + 25, h - 125, 160, 100, 36);
    ctx.fill();

    // shield emitter
    const dx = player.aimX - cx;
    const dy = player.aimY - cy;
    const ang = Math.atan2(dy, dx);

    ctx.translate(cx, cy);
    ctx.rotate(ang);

    // glow ring
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = "rgba(125,211,252,1)";
    ctx.beginPath();
    ctx.arc(90, 0, 34, 0, Math.PI * 2);
    ctx.fill();

    // shield device
    ctx.globalAlpha = 1;
    ctx.fillStyle = "rgba(234,241,255,0.92)";
    ctx.strokeStyle = "rgba(125,211,252,0.65)";
    ctx.lineWidth = 2;

    ctx.beginPath();
    ctx.arc(90, 0, 26, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // inner lens
    ctx.fillStyle = "rgba(167,139,250,0.85)";
    ctx.beginPath();
    ctx.arc(90, 0, 11, 0, Math.PI * 2);
    ctx.fill();

    // wrist strap
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = "rgba(0,0,0,0.30)";
    roundRect(40, -10, 40, 20, 10);
    ctx.fill();

    ctx.restore();
  }

  function drawCrosshair() {
    const x = player.aimX;
    const y = player.aimY;

    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = "rgba(234,241,255,0.9)";
    ctx.lineWidth = 2;

    ctx.beginPath();
    ctx.arc(x, y, 14, 0, Math.PI * 2);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(x - 22, y); ctx.lineTo(x - 10, y);
    ctx.moveTo(x + 10, y); ctx.lineTo(x + 22, y);
    ctx.moveTo(x, y - 22); ctx.lineTo(x, y - 10);
    ctx.moveTo(x, y + 10); ctx.lineTo(x, y + 22);
    ctx.stroke();

    ctx.fillStyle = "rgba(125,211,252,0.95)";
    ctx.beginPath();
    ctx.arc(x, y, 2.4, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  function drawPaused() {
    const w = window.innerWidth, h = window.innerHeight;
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fillRect(0, 0, w, h);

    ctx.fillStyle = "rgba(234,241,255,0.95)";
    ctx.font = "800 34px system-ui";
    ctx.textAlign = "center";
    ctx.fillText("PAUSED", w / 2, h / 2 - 10);

    ctx.font = "600 14px system-ui";
    ctx.fillStyle = "rgba(234,241,255,0.75)";
    ctx.fillText("לחצי P כדי להמשיך", w / 2, h / 2 + 18);
    ctx.restore();
  }

  function drawHUDTargets() {
    const w = window.innerWidth;
    ctx.save();
    ctx.globalAlpha = 0.65;
    ctx.fillStyle = "rgba(234,241,255,0.85)";
    ctx.font = "700 13px system-ui";
    ctx.textAlign = "left";
    ctx.fillText(`מטרה: ${state.winScore} נק'`, 14, 96);
    ctx.restore();
  }

  function roundRect(x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  // --- Start screen ---
  updateUI();
  showOverlay(
    "מגן השמיים",
    "מכוונים עם העכבר • יורים עם קליק/Space • Pause עם P • מצב רגוע עם C\n\nמגינים על הבניינים: 10 בניינים, 100 נקודות לניצחון.",
    "שחק"
  );
})();