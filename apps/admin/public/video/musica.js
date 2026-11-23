// Música de fondo del video: se genera en el momento (sin archivos ni derechos de autor).
// Colchón cálido + arpegio suave + bajo y un toque de ritmo, en Am – F – C – G a 88 pulsos por minuto.
const MUSICA = (() => {
  const BPM = 88, T = 60 / BPM, COMPAS = T * 4;
  const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const ACORDES = [
    { bajo: 45, notas: [57, 60, 64, 67] }, // Am7
    { bajo: 41, notas: [57, 60, 64, 65] }, // Fmaj7
    { bajo: 48, notas: [60, 64, 67, 71] }, // Cmaj7
    { bajo: 43, notas: [59, 62, 66, 67] }, // G6
  ];
  const ARPEGIO = [0, 1, 2, 3, 2, 1, 2, 3];

  /** Cadena de salida: suma de todo + eco suave para dar espacio */
  function cadena(ctx, destino) {
    const suma = ctx.createGain(); suma.gain.value = 4; // las notas están dibujadas bajas a propósito: aquí se sube a un buen nivel de fondo
    const eco = ctx.createDelay(1); eco.delayTime.value = T * 0.75;
    const retro = ctx.createGain(); retro.gain.value = 0.33;
    const tono = ctx.createBiquadFilter(); tono.type = "lowpass"; tono.frequency.value = 2600;
    const mojado = ctx.createGain(); mojado.gain.value = 0.35;
    suma.connect(destino); suma.connect(eco); eco.connect(tono); tono.connect(retro); retro.connect(eco); tono.connect(mojado); mojado.connect(destino);
    return suma;
  }
  function ruido(ctx) {
    const b = ctx.createBuffer(1, ctx.sampleRate * 0.12, ctx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    return b;
  }
  function nota(ctx, salida, tipo, freq, t, dur, pico, ataque, filtro, desafine = 0) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = tipo; o.frequency.value = freq; o.detune.value = desafine;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(pico, t + ataque);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let fin = o;
    if (filtro) { const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = filtro; o.connect(f); fin = f; }
    fin.connect(g); g.connect(salida);
    o.start(t); o.stop(t + dur + 0.05);
  }
  /** Programa un compás completo que empieza en el instante t (segundos del reloj de audio) */
  function compas(ctx, salida, t, n, ruidoBuf) {
    const a = ACORDES[n % ACORDES.length];
    for (const m of a.notas) { // colchón: dos voces apenas desafinadas por nota, con subida lenta
      nota(ctx, salida, "triangle", hz(m), t, COMPAS + 0.9, 0.028, 1.1, 1400, -5);
      nota(ctx, salida, "sine", hz(m), t, COMPAS + 0.9, 0.02, 1.1, 0, 5);
    }
    for (const b of [0, 2]) nota(ctx, salida, "sine", hz(a.bajo), t + b * T, T * 1.7, 0.16, 0.02, 0); // bajo en los tiempos 1 y 3
    ARPEGIO.forEach((i, k) => nota(ctx, salida, "triangle", hz(a.notas[i] + 12), t + k * (T / 2), 0.55, 0.05, 0.012, 3200)); // arpegio en corcheas
    for (let k = 0; k < 4; k++) { // aire suave en los contratiempos
      const s = ctx.createBufferSource(), g = ctx.createGain(), f = ctx.createBiquadFilter();
      s.buffer = ruidoBuf; f.type = "highpass"; f.frequency.value = 7500; g.gain.value = 0.035;
      s.connect(f); f.connect(g); g.connect(salida); s.start(t + k * T + T / 2);
    }
  }

  const M = { ctx: null, maestro: null, salida: null, vol: 0.14, duck: 1, activa: false, sig: 0, n: 0, reloj: 0, ruido: null };
  const nivel = () => M.vol * M.duck;
  function programar() {
    while (M.sig < M.ctx.currentTime + 4) { compas(M.ctx, M.salida, M.sig, M.n++, M.ruido); M.sig += COMPAS; }
  }
  return {
    /** volumen: 0 a 1 (0.14 es un buen fondo); conVoz: baja el nivel para que se entienda la voz */
    iniciar(volumen, conVoz) {
      try {
        if (!M.ctx) {
          M.ctx = new (window.AudioContext || window.webkitAudioContext)();
          M.maestro = M.ctx.createGain(); M.maestro.gain.value = 0; M.maestro.connect(M.ctx.destination);
          M.salida = cadena(M.ctx, M.maestro); M.ruido = ruido(M.ctx);
        }
        M.ctx.resume();
        clearInterval(M.reloj);
        M.vol = volumen; M.duck = conVoz ? 0.55 : 1; M.activa = true; M.n = 0; M.sig = M.ctx.currentTime + 0.12;
        M.maestro.gain.cancelScheduledValues(M.ctx.currentTime);
        M.maestro.gain.setValueAtTime(0, M.ctx.currentTime);
        M.maestro.gain.linearRampToValueAtTime(nivel(), M.ctx.currentTime + 1.5);
        programar(); M.reloj = setInterval(programar, 700);
      } catch (e) { /* sin audio en este navegador: el video sigue sin música */ }
    },
    volumen(v) { M.vol = v; if (M.activa) M.maestro.gain.setTargetAtTime(nivel(), M.ctx.currentTime, 0.15); },
    pausar() { try { M.ctx && M.ctx.suspend(); } catch (e) {} },
    seguir() { try { M.ctx && M.ctx.resume(); } catch (e) {} },
    /** Baja la música suavemente y la apaga (al terminar el video o al detenerlo) */
    detener(seg = 1.6) {
      if (!M.ctx || !M.activa) return; M.activa = false; clearInterval(M.reloj);
      const t = M.ctx.currentTime; M.maestro.gain.cancelScheduledValues(t); M.maestro.gain.setValueAtTime(M.maestro.gain.value, t); M.maestro.gain.linearRampToValueAtTime(0, t + seg);
      setTimeout(() => { try { if (!M.activa) M.ctx.suspend(); } catch (e) {} }, seg * 1000 + 200);
    },
    /** Dibuja la música en un archivo de audio (para pruebas o para mezclarla con ffmpeg): devuelve un AudioBuffer */
    async renderizar(segundos, tasa = 44100) {
      const ctx = new OfflineAudioContext(2, Math.ceil(segundos * tasa), tasa);
      const maestro = ctx.createGain(); maestro.gain.value = 0.3; maestro.connect(ctx.destination);
      const salida = cadena(ctx, maestro), r = ruido(ctx);
      for (let n = 0, t = 0; t < segundos; n++, t += COMPAS) compas(ctx, salida, t, n, r);
      return ctx.startRendering();
    },
  };
})();
