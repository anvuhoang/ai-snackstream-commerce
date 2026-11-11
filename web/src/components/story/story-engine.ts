/* eslint-disable */
// @ts-nocheck
// The scroll-driven 3D story of the home page, ported from the approved design. Plain DOM + three.js (r128).
// startStory() returns a function that stops it, so React can clean up on unmount.
export function startStory(THREE, Lenis) {
  var stopped = false, rafId = 0, ac = new AbortController();
  var root = document.querySelector('.story');
  var RM = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var PMAX = 1.11; // scroll progress (0..1) maps to 0..PMAX, then sceneT() adds the part of scene time that is skipped; the pour ends at 1.23
  // The Minh bach page used to stay still for a stretch while the scroll went on, which felt like the page stuck. Now the scroll skips that stretch (0.12):
  // the page slides in, and from the moment it is fully in view it slides out again, moving at the same speed as the rest of the page.
  function sceneT(x) { return x > 0.64 ? x + 0.12 : x; }
  function el(id) { return document.getElementById(id); }
  // One smooth scroll for the whole page (the way Postevand feels): the page itself is eased, and every animation reads that position directly.
  var lenis = (Lenis && !RM) ? new Lenis({ lerp: 0.085, wheelMultiplier: 1 }) : null;
  function goTo(y) { if (lenis) lenis.scrollTo(y, { duration: 1.6 }); else window.scrollTo({ top: y, behavior: RM ? 'auto' : 'smooth' }); }
  var L = { hero: el('hero'), s1: el('s1'), s2: el('s2'), s3: el('s3'), pq: el('pq'), pr: el('pr'), pA: el('pA'), pg: el('pg'), ch: el('ch'), lv: el('lv'), cl: el('cl') };
  var SANS = getComputedStyle(root).fontFamily;

  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
  function ease(x) { return x * x * (3 - 2 * x); }
  function ramp(p, a, b) { return ease(clamp((p - a) / (b - a), 0, 1)); }
  function kf(p, keys) {
    if (p <= keys[0][0]) return keys[0].slice(1);
    for (var i = 1; i < keys.length; i++) {
      if (p <= keys[i][0]) { var a = keys[i - 1], b = keys[i], u = ease((p - a[0]) / (b[0] - a[0])); return a.slice(1).map(function (v, j) { return v + (b[j + 1] - v) * u; }); }
    }
    return keys[keys.length - 1].slice(1);
  }
  function maxScroll() { return Math.max(1, el('track').offsetHeight - window.innerHeight); }
  // data-go values are in scene time (0 to about 1.6); convert to a scroll position
  Array.prototype.forEach.call(document.querySelectorAll('[data-go]'), function (b) {
    b.addEventListener('click', function (e) { if (b.tagName === 'A') e.preventDefault(); goTo((parseFloat(b.getAttribute('data-go')) / PMAX) * maxScroll()); }, { signal: ac.signal });
  });

  Array.prototype.forEach.call(document.querySelectorAll('[data-to]'), function (b) {
    b.addEventListener('click', function () { var t = el(b.getAttribute('data-to')); if (t) goTo(t.getBoundingClientRect().top + window.scrollY); }, { signal: ac.signal });
  });

  /* ----- build: statement words, shelf, journey ----- */
  var rv = el('rv'), WORDS = 'Mỗi món được đối chiếu thành phần và cách bảo quản với bao bì thật trước khi lên kệ.'.split(' ');
  rv.innerHTML = WORDS.map(function (w) { return '<span class="w">' + w + '</span>'; }).join(' ') + '<sup>[2]</sup>';
  var rvw = rv.querySelectorAll('.w');


  var IMG_KG = "/photos/kg-lc-250.webp";
  var CHM = [
    { u: 1, t: 'Khô gà lá chanh 250g giá bao nhiêu, cay không?' },
    { t: 'Khô gà lá chanh sấy giòn 250g giá 55.000đ. Mức cay của sản phẩm này chưa được xác minh, bạn vui lòng xem nhãn trên bao bì nhé.', card: 1 },
    { u: 1, t: 'Có chất gây dị ứng không?' },
    { t: 'Mình chưa có thông tin về chất gây dị ứng nên không dám khẳng định. Bạn đọc nhãn trên bao bì giúp mình nhé.' },
    { u: 1, t: 'Còn gói 500g thì sao?' },
    { t: 'Gói 500g giá 99.000đ. Mua 2 gói 250g là 110.000đ, nên gói 500g rẻ hơn 11.000đ.' }
  ];
  var chB = el('chB'); chB.innerHTML = ''; var chEls = CHM.map(function (m) {
    var d = document.createElement('div'); d.className = 'msg ' + (m.u ? 'u' : 'b');
    d.innerHTML = m.u ? m.t : '<span class="dots"><i></i><i></i><i></i></span><span class="t">' + m.t + (m.card ? '<span class="card"><img alt="" src="' + IMG_KG + '"><span><b>Khô gà lá chanh sấy giòn</b><small>Từ 55.000đ</small></span><em>Xem sản phẩm</em></span>' : '') + '</span>';
    chB.appendChild(d); return d;
  });
  el('lvImg').src = IMG_KG; el('lvPi').src = IMG_KG;
  var LVE = [
    { t: 0.2, who: 'Lan', text: 'Gói 500g giá bao nhiêu vậy shop?' },
    { t: 1.1, who: 'Host', host: 1, text: 'Gói 500g giá 99.000đ nha, rẻ hơn mua hai gói 250g là 11.000đ.' },
    { t: 2.6, who: 'Minh', text: 'Cho mình 1 gói 500g' }
  ];
  var lvC = el('lvC'); lvC.innerHTML = ''; var lvEls = LVE.map(function (c) {
    var d = document.createElement('div'); if (c.host) d.className = 'h';
    d.innerHTML = '<b>' + c.who + '</b>' + c.text; lvC.appendChild(d); return d;
  });

  function slide(layer, u, life) {
    layer.style.visibility = u > 0.001 ? 'visible' : 'hidden';
    layer.style.transform = 'translateY(' + ((1 - u) * 100).toFixed(2) + '%)';
    layer.style.setProperty('--py', ((life - 0.5) * -9).toFixed(2) + '%');
    layer.classList.toggle('on', u > 0.98);
  }
  function show(layer, o) { layer.style.visibility = o > 0.02 ? 'visible' : 'hidden'; layer.style.opacity = o.toFixed(3); layer.classList.toggle('on', o > 0.5); }

  function slideTo(layer, uIn, uOut) {
    layer.style.visibility = (uIn > 0.001 && uOut < 0.999) ? 'visible' : 'hidden';
    layer.style.transform = 'translateY(' + (((1 - uIn) - uOut) * 100).toFixed(2) + '%)';
    layer.classList.toggle('on', uIn > 0.98 && uOut < 0.02);
  }
  var lastStep = -1;
  function ui(p) {
    show(L.hero, 1 - ramp(p, 0.07, 0.13));
    L.hero.querySelector('h1').style.transform = 'translateX(' + (-ramp(p, 0.0, 0.14) * 24).toFixed(1) + 'vw)';
    show(L.s1, ramp(p, 0.14, 0.18) * (1 - ramp(p, 0.29, 0.33)));
    show(L.s2, ramp(p, 0.33, 0.37) * (1 - ramp(p, 0.46, 0.49)));
    show(L.s3, ramp(p, 0.49, 0.53) * (1 - ramp(p, 0.56, 0.60)));

    // T: statement page first, slides up over the scene and then leaves through the top
    var sa = clamp((p - 0.56) / 0.08, 0, 1), sb = clamp((p - 0.76) / 0.08, 0, 1);
    slideTo(L.pA, sa, sb);
    el('scene').style.transform = 'translateY(' + (p < 0.7 ? -sa * 100 : (1 - sb) * 100).toFixed(2) + '%)';
    // Q: a quiet page, the bag stands alone
    show(L.pq, ramp(p, 0.82, 0.86) * (1 - ramp(p, 0.92, 0.95)));
    // P: the same bag tilts and pours into a bowl
    show(L.pr, ramp(p, 0.98, 1.02));
    var pu0 = clamp((p - 1.04) / 0.20, 0, 1);
    el('prG').textContent = Math.round(250 * clamp((pu0 - 0.04) / 0.78, 0, 1)) + 'g';

  }

  // Sections after the pinned part are plain page flow; their small animations follow where they sit in the viewport.
  function flow() {
    var vh = window.innerHeight, c = el('ch').getBoundingClientRect(), v = el('lv').getBoundingClientRect(), d = el('cl').getBoundingClientRect();
    var cm = clamp(-c.top / Math.max(1, c.height - vh), 0, 1) * 7;
    for (var ci = 0; ci < chEls.length; ci++) {
      var bot = !CHM[ci].u;
      chEls[ci].classList.toggle('pre', cm > ci + 0.05);
      chEls[ci].classList.toggle('on', cm > ci + (bot ? 0.55 : 0.05));
    }
    var lm = clamp(-v.top / Math.max(1, v.height - vh), 0, 1) * 6;
    for (var li = 0; li < lvEls.length; li++) lvEls[li].classList.toggle('on', lm > LVE[li].t);
    el('lvP').classList.toggle('on', lm > 1.9);
    el('lvT').classList.toggle('on', lm > 3.6 && lm < 5.4);
    el('lvK').textContent = lm > 3.6 ? '1' : '0';
    el('lvV').textContent = (1.2 + 0.3 * (lm / 6)).toFixed(1).replace('.', ',') + 'K';
    var q = ease(clamp((vh - d.top) / (vh * 0.9), 0, 1));
    Array.prototype.forEach.call(L.cl.querySelectorAll('.n'), function (n) {
      var t = parseFloat(n.getAttribute('data-t')), x = Math.round(t * q);
      n.textContent = n.getAttribute('data-f') === 'd' ? x.toLocaleString('vi-VN') + 'đ' : String(x);
    });
  }

  var cur = 0, target = 0;
  var old = el('stage'), canvas = document.createElement('canvas'), renderer;
  canvas.id = 'stage'; canvas.setAttribute('aria-hidden', 'true'); old.parentNode.replaceChild(canvas, old);
  try { renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true }); } catch (e) { renderer = null; }
  ui(0); flow();
  if (!renderer) { root.classList.add('nogl'); var onScroll = function () { ui(sceneT(clamp(window.scrollY / maxScroll(), 0, 1) * PMAX)); flow(); }; window.addEventListener('scroll', onScroll, { passive: true }); var lr = function (t) { if (stopped) return; if (lenis) lenis.raf(t); rafId = requestAnimationFrame(lr); }; rafId = requestAnimationFrame(lr); return function () { stopped = true; cancelAnimationFrame(rafId); ac.abort(); window.removeEventListener('scroll', onScroll); if (lenis) lenis.destroy(); }; }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputEncoding = THREE.sRGBEncoding; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.95;
  renderer.setClearColor(0x000000, 0);
  var scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(32, 1, 0.1, 60);
  scene.add(new THREE.HemisphereLight(0xffffff, 0xcfd4d8, 0.72));
  var key = new THREE.DirectionalLight(0xfff1dc, 1.35); key.position.set(-3, 4, 5); scene.add(key);
  var fill = new THREE.DirectionalLight(0xe6efff, 0.6); fill.position.set(4, 1, 4); scene.add(fill);
  var back = new THREE.DirectionalLight(0xffffff, 0.5); back.position.set(0, 2, -5); scene.add(back);

  function fit(g, text, maxW, size, weight) { do { g.font = weight + ' ' + size + 'px ' + SANS; size -= 4; } while (g.measureText(text).width > maxW && size > 30); return size + 4; }
  function wrap(g, text, x, y, maxW, lh) {
    var words = text.split(' '), line = '';
    for (var i = 0; i < words.length; i++) { var t = line ? line + ' ' + words[i] : words[i]; if (g.measureText(t).width > maxW && line) { g.fillText(line, x, y); line = words[i]; y += lh; } else line = t; }
    if (line) { g.fillText(line, x, y); y += lh; } return y;
  }
  function frontTex() {
    // The real khô gà lá chanh pouch (cut from the product photo) between two frosted seal bands.
    var W = 1024, H = 1536, c = document.createElement('canvas'); c.width = W; c.height = H; var g = c.getContext('2d');
    var sg = g.createLinearGradient(0, 0, W, 0); sg.addColorStop(0, '#d5d9db'); sg.addColorStop(.5, '#eceff0'); sg.addColorStop(1, '#cfd3d5');
    g.fillStyle = sg; g.fillRect(0, 0, W, H);
    var top = 175, h = H - 350;
    if (bagImg && bagImg.naturalWidth) g.drawImage(bagImg, 0, top, W, h); else { g.fillStyle = '#c9a77a'; g.fillRect(0, top, W, h); }
    g.strokeStyle = 'rgba(0,0,0,.10)'; g.lineWidth = 3;
    for (var x = 10; x < W; x += 16) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 160); g.moveTo(x, H - 160); g.lineTo(x, H); g.stroke(); }
    g.fillStyle = 'rgba(0,0,0,.08)'; g.fillRect(0, top - 6, W, 6); g.fillRect(0, H - top, W, 6);
    var sh = g.createLinearGradient(0, 0, W, 0); sh.addColorStop(0, 'rgba(0,0,0,.22)'); sh.addColorStop(.09, 'rgba(0,0,0,0)'); sh.addColorStop(.91, 'rgba(0,0,0,0)'); sh.addColorStop(1, 'rgba(0,0,0,.22)');
    g.fillStyle = sh; g.fillRect(0, 0, W, H);
    return c;
  }
  function backTex() {
    var W = 1024, H = 1536, c = document.createElement('canvas'); c.width = W; c.height = H; var g = c.getContext('2d');
    g.fillStyle = '#F4EBDA'; g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(0,0,0,.10)'; g.fillRect(0, 0, W, 175); g.fillRect(0, H - 175, W, 175);
    g.strokeStyle = 'rgba(0,0,0,.10)'; g.lineWidth = 3;
    for (var x = 10; x < W; x += 16) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 160); g.moveTo(x, H - 160); g.lineTo(x, H); g.stroke(); }
    g.textAlign = 'left'; g.fillStyle = '#15110F'; var L0 = 110, maxW = W - 220, y = 330;
    g.font = '600 38px ' + SANS; if ('letterSpacing' in g) g.letterSpacing = '8px'; g.fillText('THÀNH PHẦN', L0, y); if ('letterSpacing' in g) g.letterSpacing = '0px';
    g.font = '400 54px ' + SANS; y = wrap(g, 'Ức gà, lá chanh, ớt xanh, gia vị.', L0, y + 80, maxW, 74); y += 70;
    g.font = '600 38px ' + SANS; if ('letterSpacing' in g) g.letterSpacing = '8px'; g.fillText('BẢO QUẢN', L0, y); if ('letterSpacing' in g) g.letterSpacing = '0px';
    g.font = '400 50px ' + SANS; y = wrap(g, 'Đậy kín, để nơi khô ráo. Hạn dùng 6 tháng, xem ngày trên nhãn từng lô.', L0, y + 76, maxW, 70);
    g.fillStyle = 'rgba(21,17,15,.6)'; g.font = '500 38px ' + SANS; g.fillText('Khối lượng tịnh 250g', L0, H - 250);
    g.font = '600 44px ' + SANS; g.fillStyle = '#1F5D46'; g.fillText('snackstream', L0, H - 190);
    return c;
  }
  function tex(c) { var t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; t.anisotropy = renderer.capabilities.getMaxAnisotropy(); return t; }
  function sheet(sign) {
    var W = 1.5, H = 2.3, g = new THREE.PlaneGeometry(W, H, 60, 92), pos = g.attributes.position;
    for (var i = 0; i < pos.count; i++) {
      var nx = pos.getX(i) / (W / 2), ny = pos.getY(i) / (H / 2);
      var b = Math.pow(Math.max(0, 1 - nx * nx), 0.55) * Math.pow(Math.max(0, 1 - ny * ny), 0.5) * 0.44; b *= 1 + 0.05 * Math.sin(ny * 8 + nx * 3);
      var seal = THREE.MathUtils.smoothstep(Math.abs(ny), 0.78, 0.9); b = b * (1 - seal) + seal * 0.05; b += seal * 0.014 * Math.sin(pos.getX(i) * 75);
      pos.setZ(i, sign * b);
    }
    g.computeVertexNormals(); return g;
  }

  var bag, shadow, orbit = new THREE.Group(), items = [], bowl, bowlShadow, pile, pieces = [], parts = [], instMeshes = [], dummy = new THREE.Object3D();
  function build() {
    var tf = tex(frontTex()), tb = tex(backTex()); tb.wrapS = THREE.RepeatWrapping; tb.repeat.x = -1; tb.offset.x = 1;
    var mk = function (m) { return new THREE.MeshPhysicalMaterial({ map: m, roughness: 0.42, metalness: 0.1, clearcoat: 0.55, clearcoatRoughness: 0.3, side: THREE.DoubleSide }); };
    bag = new THREE.Group(); bag.add(new THREE.Mesh(sheet(1), mk(tf))); bag.add(new THREE.Mesh(sheet(-1), mk(tb))); scene.add(bag);
    var sc = document.createElement('canvas'); sc.width = sc.height = 256; var sg = sc.getContext('2d'), gr = sg.createRadialGradient(128, 128, 0, 128, 128, 128);
    gr.addColorStop(0, 'rgba(0,0,0,.42)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); sg.fillStyle = gr; sg.fillRect(0, 0, 256, 256);
    shadow = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 1.1), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(sc), transparent: true, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2; shadow.position.y = -1.6; scene.add(shadow);

    scene.add(orbit);
    var chiliM = new THREE.MeshStandardMaterial({ color: 0x2f9a35, roughness: .4 }), stemM = new THREE.MeshStandardMaterial({ color: 0x2c6b2a, roughness: .6 });
    var leafM = new THREE.MeshStandardMaterial({ color: 0x2b8a3c, roughness: .55 }), meatM = new THREE.MeshStandardMaterial({ color: 0xc9955a, roughness: .7 });
    var saltM = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .35 }), pepM = new THREE.MeshStandardMaterial({ color: 0x2a211b, roughness: .6 });
    function reg(m, s) {
      m.userData = { far: new THREE.Vector3((Math.random() - .5) * 15, (Math.random() - .5) * 9, Math.random() * 6 - 3), r: 1.4 + Math.random() * 1.2, a: Math.random() * 6.283, h: (Math.random() - .5) * 2.8,
        sp: (0.12 + Math.random() * 0.2) * (Math.random() < .5 ? -1 : 1), s: s, stag: Math.random(), spin: new THREE.Vector3(Math.random() - .5, Math.random() - .5, Math.random() - .5).multiplyScalar(2.2) };
      m.scale.setScalar(0.0001); orbit.add(m); items.push(m);
    }
    var i, m;
    for (i = 0; i < 10; i++) { m = new THREE.Group(); var cb = new THREE.Mesh(new THREE.ConeGeometry(.07, .55, 12), chiliM); cb.rotation.z = Math.PI / 2; cb.position.x = .1; var st = new THREE.Mesh(new THREE.CylinderGeometry(.018, .028, .12, 8), stemM); st.rotation.z = Math.PI / 2; st.position.x = -.22; m.add(cb); m.add(st); reg(m, .95 + Math.random() * .4); }
    for (i = 0; i < 16; i++) { m = new THREE.Mesh(new THREE.SphereGeometry(.11, 12, 8), leafM); m.geometry = m.geometry.clone(); m.geometry.scale(1.5, .1, .65); reg(m, 1 + Math.random() * .5); }
    for (i = 0; i < 14; i++) { m = new THREE.Mesh(new THREE.CylinderGeometry(.028, .028, .5, 8), meatM); reg(m, .9 + Math.random() * .5); }
    for (i = 0; i < 30; i++) { m = new THREE.Mesh(new THREE.OctahedronGeometry(.03), saltM); reg(m, 1 + Math.random()); }
    for (i = 0; i < 14; i++) { m = new THREE.Mesh(new THREE.SphereGeometry(.035, 8, 6), pepM); reg(m, 1 + Math.random() * .6); }

    // pour scene: a bowl and the pieces that fall into it
    bowl = new THREE.Group();
    var prof = [[0.001, 0], [0.55, 0], [0.95, 0.16], [1.15, 0.5], [1.2, 0.62], [1.13, 0.62], [1.08, 0.5], [0.9, 0.22], [0.5, 0.09], [0.001, 0.09]].map(function (q) { return new THREE.Vector2(q[0], q[1]); });
    bowl.add(new THREE.Mesh(new THREE.LatheGeometry(prof, 56), new THREE.MeshStandardMaterial({ color: 0xE6DECE, roughness: 0.55, side: THREE.DoubleSide })));
    scene.add(bowl);
    var bc = document.createElement('canvas'); bc.width = bc.height = 256; var bg2 = bc.getContext('2d'), bgr = bg2.createRadialGradient(128, 128, 0, 128, 128, 128);
    bgr.addColorStop(0, 'rgba(0,0,0,.4)'); bgr.addColorStop(1, 'rgba(0,0,0,0)'); bg2.fillStyle = bgr; bg2.fillRect(0, 0, 256, 256);
    bowlShadow = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 1.5), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(bc), transparent: true, depthWrite: false }));
    bowlShadow.rotation.x = -Math.PI / 2; scene.add(bowlShadow);
    // Dried shredded chicken, modelled in 3D: curly strands with real thickness (tubes), small green chilli pieces and lime leaves
    // (real leaf photos on curved leaves). Thousands of pieces are drawn as a few instanced meshes; they fall into the bowl and fill it
    // as a volume, deeper pieces darker, so the heap has depth.
    function seeded(seed) { return function (k) { var x = Math.sin(seed * 91.7 + k * 12.9898) * 43758.5453; return x - Math.floor(x); }; }
    function strandGeo(len, rad, seed) {
      var rnd = seeded(seed), pts = [], K = 7, i;
      for (i = 0; i <= K; i++) {
        var u = i / K;
        pts.push(new THREE.Vector3((u - 0.5) * len,
          Math.sin(u * 6.283 * (0.7 + rnd(1)) + rnd(2) * 6) * len * 0.13 * (0.4 + rnd(3)) + (rnd(10 + i) - 0.5) * len * 0.08,
          Math.cos(u * 6.283 * (0.6 + rnd(5)) + rnd(6) * 6) * len * 0.11 * (0.4 + rnd(7))));
      }
      return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 28, rad, 5, false);
    }
    function bentLeaf(w, h, seed) {
      var rnd = seeded(seed), g = new THREE.PlaneGeometry(w, h, 8, 4), pos = g.attributes.position, am = 0.05 + rnd(1) * 0.07;
      for (var i = 0; i < pos.count; i++) {
        var x = pos.getX(i) / w, y = pos.getY(i) / h;
        pos.setZ(i, (x * x * 1.2 + Math.abs(y) * 0.25) * am * 4 - Math.sin((x + 0.5) * 3.14) * am);
      }
      g.computeVertexNormals(); return g;
    }
    function lin(hex) { return new THREE.Color(hex).convertSRGBToLinear(); }
    var CHICKEN = ['#d98a35', '#c97a2b', '#b86d26', '#e0a04a', '#a9602a', '#cf8630', '#8f4f1f', '#e8b45f'].map(lin), CHILI = ['#3f9d3d', '#56ad45', '#2f7f33'].map(lin);
    var strandMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.78, metalness: 0 });
    var chiliMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.45, metalness: 0 });
    function leafMat(im) { var t = new THREE.Texture(im); t.encoding = THREE.sRGBEncoding; t.needsUpdate = true; return new THREE.MeshStandardMaterial({ map: t, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.7 }); }
    var leafImgs = [leafAImg, leafBImg].filter(function (im) { return im.naturalWidth; });

    // a dark shaded base under the pieces so no white shows through the heap
    pile = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x2a1608, roughness: 1 }));
    pile.position.set(0, 0.2, 0); pile.scale.set(0.7, 0.001, 0.7); pile.visible = false; bowl.add(pile);

    function inst(geo, mat, count) {
      var m = new THREE.InstancedMesh(geo, mat, count);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.frustumCulled = false; m.visible = false; scene.add(m); instMeshes.push(m); return m;
    }
    // what is in the bag: 6 strand shapes, chilli bits and leaves
    var specs = [], sv, li2, k2;
    var SM = [];
    for (sv = 0; sv < 8; sv++) { SM.push(inst(strandGeo(0.42 + sv * 0.07, 0.010 + (sv % 3) * 0.002, sv + 3), strandMat, 190)); for (k2 = 0; k2 < 190; k2++) specs.push({ m: SM[sv], kind: 's' }); }
    var CM = inst(strandGeo(0.1, 0.017, 41), chiliMat, 130); for (k2 = 0; k2 < 130; k2++) specs.push({ m: CM, kind: 'c' });
    leafImgs.forEach(function (im, idx) { var lm = inst(bentLeaf(0.42, 0.42 * im.naturalHeight / im.naturalWidth, idx + 7), leafMat(im), 60); for (var q2 = 0; q2 < 60; q2++) specs.push({ m: lm, kind: 'l' }); });
    for (var sh = specs.length - 1; sh > 0; sh--) { var sj = (Math.random() * (sh + 1)) | 0, st = specs[sh]; specs[sh] = specs[sj]; specs[sj] = st; }

    var R = 0.9, HP = 0.5, YAX = new THREE.Vector3(0, 1, 0), bowlQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.55, 0, 0)), cnt = new Map(), NPT = specs.length;
    for (var n = 0; n < NPT; n++) {
      var sp = specs[n], idx2 = cnt.get(sp.m) || 0; cnt.set(sp.m, idx2 + 1);
      var pr = Math.sqrt(Math.random()) * 0.54, pa = Math.random() * 6.283, b0 = 0.04 + 0.78 * (n / NPT) + (Math.random() - 0.5) * 0.02, dur = 0.07 + Math.random() * 0.09;
      var pgl = Math.min(1, Math.max(0, (b0 + dur - 0.04) / 0.8)), gh = pgl * pgl * (3 - 2 * pgl);
      var px = Math.cos(pa) * pr, pz = Math.sin(pa) * pr, surf = HP * gh * Math.sqrt(Math.max(0, 1 - (pr / R) * (pr / R)));
      var dep = Math.pow(Math.random(), 0.45), shade = 0.45 + 0.55 * dep;   // 1 = on top of the heap, lower = buried
      var nrm = new THREE.Vector3(px / (R * R), Math.max(surf, 0.03) / (HP * HP), pz / (R * R)).normalize();
      var qs = new THREE.Quaternion().setFromUnitVectors(YAX, nrm);
      var qy = new THREE.Quaternion().setFromAxisAngle(YAX, Math.random() * 6.283);
      var qj = new THREE.Quaternion().setFromEuler(new THREE.Euler((Math.random() - .5) * 0.9, 0, (Math.random() - .5) * 0.9));
      var tq = bowlQ.clone().multiply(qs).multiply(qy).multiply(qj);
      if (sp.kind === 'l') tq.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0)));
      var col = (sp.kind === 'c' ? CHILI[(Math.random() * CHILI.length) | 0] : CHICKEN[(Math.random() * CHICKEN.length) | 0]).clone();
      if (sp.kind !== 'l') { col.multiplyScalar(shade); sp.m.setColorAt(idx2, col); }
      parts.push({ st: -1, m: sp.m, i: idx2, b: b0, dur: dur, lx: -0.74 + Math.random() * 0.8, ly: 1.05 + Math.random() * 0.1,
        T: new THREE.Vector3(px, 0.32 + surf * (0.3 + 0.7 * dep), pz), sc: 0.85 + Math.random() * 0.3,
        spin: new THREE.Vector3((Math.random() - .5) * 8, (Math.random() - .5) * 8, (Math.random() - .5) * 8), q: tq });
    }
    instMeshes.forEach(function (m) { if (m.instanceColor) m.instanceColor.needsUpdate = true; });
    start();
  }

  var KA = [
    [0.00, 1.9, -0.3, 0, -0.4, 0.1, 0.5, 1.15],
    [0.09, 1.9, -0.3, 0, -0.2, 0.1, 0.45, 1.15],
    [0.16, 0, -0.05, 0, 0, 0, 0, 1.0],
    [0.31, 0, -0.05, 0, 0.12, 0, 0, 1.0],
    [0.39, 0, 0, 0.3, 1.9, 0.15, 0.3, 1.15],
    [0.46, 0, 0, 0.3, 4.2, 0.35, -0.35, 1.2],
    [0.54, 0, 0, 0.5, 6.0, 0.1, 0.15, 1.25],
    [0.62, 0, 0, 0.5, 6.0, 0.1, 0.15, 1.25],
    [0.70, 0, 1.2, 0.5, 6.4, 0.05, 0.0, 1.1],
    [0.84, 0, 0.5, 0.5, 6.4, 0.05, 0.0, 1.1],
    [0.94, 0, 0, 0.5, 6.4, 0.05, 0.0, 1.1],
    [1.02, 1.7, 0.6, 0.4, 6.4, 0.0, 2.0, 0.85],
    [1.22, 1.7, 0.6, 0.4, 6.4, 0.0, 2.2, 0.85],
    [1.27, 2.5, 1.3, 0.3, 6.4, 0.0, 0.7, 0.5],
    [1.30, 2.5, 1.3, 0.3, 6.4, 0.0, 0.7, 0.0001],
    [4.00, 2.5, 1.3, 0.3, 6.4, 0.0, 0.7, 0.0001]
  ];
  var last = 0, portrait = false, tmpO = new THREE.Object3D(), tmpS = new THREE.Vector3(), tmpT = new THREE.Vector3(), tmpE = new THREE.Euler(), tmpQ = new THREE.Quaternion();
  function resize() { var w = innerWidth, h = innerHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); portrait = w / h < 0.85; }
  window.addEventListener('resize', resize); resize();

  function frame(now) {
    if (stopped) return; rafId = requestAnimationFrame(frame); if (document.hidden) return;
    var t = now / 1000, dt = Math.min(0.05, t - last); last = t;
    if (lenis) lenis.raf(now); target = clamp(scrollY / maxScroll(), 0, 1); cur = target;
    var p = sceneT(cur * PMAX); ui(p); flow();
    var v = kf(p, KA), sf = portrait ? 0.74 : 1, xs = portrait ? 0.25 : 1, idle = RM ? 0 : 1;
    bag.visible = v[6] > 0.01;
    bag.position.set(v[0] * xs, v[1] + (portrait ? 0.15 : 0) + Math.sin(t * 1.1) * 0.05 * idle, v[2]);
    bag.rotation.set(v[4], v[3] + Math.sin(t * .6) * .03 * idle, v[5]);
    bag.scale.setScalar(v[6] * sf);
    shadow.visible = bag.visible; shadow.material.opacity = clamp(1 - Math.abs(v[5]) * 2.2, 0, 1) * clamp(v[6], 0, 1);
    shadow.position.x = bag.position.x; shadow.scale.setScalar(v[6] * sf);

    var inPour = p > 0.94 && p < 1.45, bowlIn = ramp(p, 0.96, 1.02), bx = portrait ? 0 : 0.1, by = portrait ? -1.5 : -1.05;
    bowl.visible = inPour; bowlShadow.visible = inPour;
    bowl.position.set(bx, by - (1 - bowlIn) * 2.6, 0.3); bowl.rotation.set(0.55, 0, 0); bowl.scale.setScalar(portrait ? 0.85 : 1);
    bowlShadow.position.set(bx, by - 0.04 - (1 - bowlIn) * 2.6, 0.3); bowlShadow.material.opacity = bowlIn;
    bowl.updateMatrixWorld(true);
    var pu = clamp((p - 1.04) / 0.20, 0, 1), pgr = ease(clamp((pu - 0.04) / 0.80, 0, 1));
    pile.visible = inPour && pgr > 0.01;
    pile.scale.set(0.7 * (0.45 + 0.55 * pgr), 0.36 * pgr * pgr + 0.001, 0.7 * (0.45 + 0.55 * pgr));
    for (var mi = 0; mi < instMeshes.length; mi++) instMeshes[mi].visible = inPour;
    if (inPour) {
      // Only pieces that are moving, or that just changed state, are recomputed: hidden and settled pieces keep their matrix.
      var force = pile.userData.pt !== portrait, bowlStatic = bowlIn >= 0.999, chg = force;
      pile.userData.pt = portrait;
      for (var n = 0; n < parts.length; n++) {
        var pd = parts[n], want = pu < pd.b ? 0 : (pu - pd.b >= pd.dur ? 2 : 1);
        if (!force && want === pd.st && (want === 0 || (want === 2 && bowlStatic))) continue;
        pd.st = want; chg = true;
        if (want === 0) { dummy.position.set(0, -50, 0); dummy.scale.setScalar(0.0001); dummy.updateMatrix(); pd.m.setMatrixAt(pd.i, dummy.matrix); continue; }
        var tau = clamp((pu - pd.b) / pd.dur, 0, 1), e = 1 - ease(tau);
        tmpT.copy(pd.T).applyMatrix4(bowl.matrixWorld);
        if (tau < 1) {
          var vb = kf(1.04 + pd.b * 0.20, KA);
          tmpO.position.set(vb[0] * (portrait ? 0.25 : 1), vb[1] + (portrait ? 0.15 : 0), vb[2]); tmpO.rotation.set(vb[4], vb[3], vb[5]); tmpO.scale.setScalar(vb[6] * (portrait ? 0.74 : 1)); tmpO.updateMatrix();
          tmpS.set(pd.lx, pd.ly, 0.05).applyMatrix4(tmpO.matrix);
          dummy.position.set(tmpS.x + (tmpT.x - tmpS.x) * tau, tmpS.y + (tmpT.y - tmpS.y) * tau * tau, tmpS.z + (tmpT.z - tmpS.z) * tau);
        } else dummy.position.copy(tmpT);
        // tumbling while it falls, then settling onto the heap
        tmpE.set(pd.spin.x * e * e, pd.spin.y * e * e, pd.spin.z * e * e); tmpQ.setFromEuler(tmpE);
        dummy.quaternion.copy(pd.q).multiply(tmpQ);
        dummy.scale.setScalar(pd.sc * (portrait ? 0.85 : 1)); dummy.updateMatrix(); pd.m.setMatrixAt(pd.i, dummy.matrix);
      }
      if (chg) for (var mj = 0; mj < instMeshes.length; mj++) instMeshes[mj].instanceMatrix.needsUpdate = true;
    }
    camera.position.set(0, 0.1, (p < 0.1 ? 7.4 : 7.0) * (portrait ? 1.3 : 1)); camera.lookAt(0, 0, 0);
    var ik = ramp(p, 0.47, 0.53) * (1 - ramp(p, 0.56, 0.60));
    orbit.position.copy(bag.position); orbit.visible = ik > 0.002;
    if (orbit.visible) for (var i = 0; i < items.length; i++) {
      var m = items[i], u = m.userData, ke = ease(clamp(ik * 1.5 - u.stag * 0.5, 0, 1)), a = u.a + t * u.sp * (RM ? 0 : 1);
      var ox = Math.cos(a) * u.r, oy = u.h, oz = Math.sin(a) * u.r * 0.85;
      m.position.set(u.far.x + (ox - u.far.x) * ke, u.far.y + (oy - u.far.y) * ke, u.far.z + (oz - u.far.z) * ke);
      m.scale.setScalar(Math.max(0.0001, u.s * ke));
      if (!RM) { m.rotation.x += u.spin.x * dt; m.rotation.y += u.spin.y * dt; m.rotation.z += u.spin.z * dt; }
    }
    renderer.render(scene, camera);
  }
  function start() { if (!stopped) rafId = requestAnimationFrame(frame); }
  var ready = (document.fonts && document.fonts.load) ? Promise.race([Promise.all([document.fonts.load('600 80px ' + SANS), document.fonts.load('400 40px ' + SANS)]), new Promise(function (r) { setTimeout(r, 3000); })]) : Promise.resolve();
  var bagImg = new Image(); bagImg.src = '/photos/kg-lc-250-bag.webp';
  var shredImg = new Image(), leafAImg = new Image(), leafBImg = new Image();
  shredImg.src = '/photos/kg-shred.webp'; leafAImg.src = '/photos/leaf-a.webp'; leafBImg.src = '/photos/leaf-b.webp';
  var imgReady = Promise.race([Promise.all([bagImg, shredImg, leafAImg, leafBImg].map(function (im) { return new Promise(function (res) { im.onload = res; im.onerror = res; }); })), new Promise(function (res) { setTimeout(res, 5000); })]);
  var go = function () { if (!stopped) build(); };
  Promise.all([ready, imgReady]).then(go, go);
  return function () { stopped = true; cancelAnimationFrame(rafId); ac.abort(); window.removeEventListener('resize', resize); if (lenis) lenis.destroy(); renderer.dispose(); };
}
