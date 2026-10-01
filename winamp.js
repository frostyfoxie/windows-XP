/**
 * Winamp 2.80 Classic (Webamp-Exact Replica Module)
 * Faithful to Nullsoft Winamp 2.x & Jordan Eldredge's Webamp specifications.
 */
window.WinampPlayer = (function () {
  let audioCtx = null;
  let analyser = null;
  let gainNode = null;
  let stereoPanner = null;
  let isPlaying = false;
  let currentTrackIndex = 0;
  let isShuffle = true;
  let isRepeat = false;
  let customAudioElement = null;
  let audioSourceNode = null;
  let synthOsc = null;
  let timerInterval = null;
  let currentSeconds = 111;

  const defaultTracks = [
    { title: "Crusher-P - Echo", duration: "3:50", isSynth: true, freq: 329 },
    { title: "Mori Calliope - Go-Getters", duration: "3:15", isSynth: true, freq: 220 },
    { title: "CircusP - Goodbye", duration: "3:24", isSynth: true, freq: 261 },
    { title: "AmaLee - Siren", duration: "4:02", isSynth: true, freq: 293 },
    { title: "M83 - Midnight City", duration: "4:03", isSynth: true, freq: 349 },
    { title: "Sunnexo - Please Wait", duration: "4:15", isSynth: true, freq: 392 },
    { title: "Omaru Polka - Persona", duration: "4:56", isSynth: true, freq: 440 }
  ];

  let playlist = [...defaultTracks];

  function init() {
    renderPlaylist();
    drawEqSpline();
  }

  function initAudioContext() {
    if (audioCtx) return;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AudioContext();
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 64;
    gainNode = audioCtx.createGain();
    gainNode.gain.value = 0.8;

    if (audioCtx.createStereoPanner) {
      stereoPanner = audioCtx.createStereoPanner();
      gainNode.connect(stereoPanner);
      stereoPanner.connect(analyser);
    } else {
      gainNode.connect(analyser);
    }

    analyser.connect(audioCtx.destination);
    requestAnimationFrame(drawSpectrum);
  }

  function play() {
    initAudioContext();
    if (audioCtx.state === 'suspended') audioCtx.resume();

    isPlaying = true;
    const playBtn = document.getElementById('waPlayBtn');
    if (playBtn) playBtn.classList.add('active');

    const track = playlist[currentTrackIndex];
    if (!track) return;

    const trackTitleEl = document.getElementById('winampTrackTitle');
    if (trackTitleEl) {
      trackTitleEl.innerText = `${currentTrackIndex + 1}. ${track.title} (${track.duration})`;
    }

    if (window.MSNMessenger && window.MSNMessenger.setListeningTrack) {
      window.MSNMessenger.setListeningTrack(`${currentTrackIndex + 1}. ${track.title} (${track.duration})`);
    }

    if (track.isSynth) {
      if (synthOsc) { try { synthOsc.stop(); } catch (e) {} }
      synthOsc = audioCtx.createOscillator();
      synthOsc.type = 'sawtooth';
      synthOsc.frequency.setValueAtTime(track.freq || 260, audioCtx.currentTime);
      synthOsc.connect(gainNode);
      synthOsc.start();
    } else if (customAudioElement) {
      customAudioElement.play().catch(e => console.warn(e));
    }

    if (!timerInterval) {
      timerInterval = setInterval(() => {
        currentSeconds++;
        const mins = Math.floor(currentSeconds / 60).toString().padStart(2, '0');
        const secs = (currentSeconds % 60).toString().padStart(2, '0');
        const timerEl = document.getElementById('winampTimer');
        if (timerEl) timerEl.innerText = `${mins}:${secs}`;
        const seekBar = document.getElementById('winampSeekBar');
        if (seekBar) seekBar.value = (currentSeconds % 100);
      }, 1000);
    }
  }

  function pause() {
    isPlaying = false;
    const playBtn = document.getElementById('waPlayBtn');
    if (playBtn) playBtn.classList.remove('active');
    if (synthOsc) { try { synthOsc.stop(); } catch (e) {} synthOsc = null; }
    if (customAudioElement) customAudioElement.pause();
    clearInterval(timerInterval);
    timerInterval = null;
  }

  function stop() {
    pause();
    currentSeconds = 0;
    const timerEl = document.getElementById('winampTimer');
    if (timerEl) timerEl.innerText = '00:00';
    const seekBar = document.getElementById('winampSeekBar');
    if (seekBar) seekBar.value = 0;
  }

  function next() {
    stop();
    currentTrackIndex = (currentTrackIndex + 1) % playlist.length;
    renderPlaylist();
    play();
  }

  function prev() {
    stop();
    currentTrackIndex = (currentTrackIndex - 1 + playlist.length) % playlist.length;
    renderPlaylist();
    play();
  }

  function setVolume(val) {
    initAudioContext();
    if (gainNode) gainNode.gain.value = val / 100;
  }

  function setBalance(val) {
    initAudioContext();
    if (stereoPanner) stereoPanner.pan.value = val / 100;
  }

  function seek(val) {
    currentSeconds = Math.floor((val / 100) * 230);
    const mins = Math.floor(currentSeconds / 60).toString().padStart(2, '0');
    const secs = (currentSeconds % 60).toString().padStart(2, '0');
    const timerEl = document.getElementById('winampTimer');
    if (timerEl) timerEl.innerText = `${mins}:${secs}`;
  }

  function toggleShuffle() {
    isShuffle = !isShuffle;
    const btn = document.getElementById('waShuffleBtn');
    if (btn) btn.classList.toggle('active', isShuffle);
  }

  function toggleRepeat() {
    isRepeat = !isRepeat;
    const btn = document.getElementById('waRepeatBtn');
    if (btn) btn.classList.toggle('active', isRepeat);
  }

  function toggleEq() {
    const panel = document.getElementById('waEqWindowPanel');
    if (!panel) return;
    panel.classList.toggle('hidden');
    const btn = document.getElementById('waEqToggleBtn');
    if (btn) btn.classList.toggle('active', !panel.classList.contains('hidden'));
  }

  function togglePl() {
    const panel = document.getElementById('waPlWindowPanel');
    if (!panel) return;
    panel.classList.toggle('hidden');
    const btn = document.getElementById('waPlToggleBtn');
    if (btn) btn.classList.toggle('active', !panel.classList.contains('hidden'));
  }

  function toggleEqOn() {
    const btn = document.getElementById('waEqOnBtn');
    if (btn) btn.classList.toggle('active');
  }

  function drawSpectrum() {
    const canvas = document.getElementById('winampVisCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const bufferLength = analyser ? analyser.frequencyBinCount : 16;
    const dataArray = new Uint8Array(bufferLength);

    if (analyser && isPlaying) {
      analyser.getByteFrequencyData(dataArray);
    }

    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const barWidth = (canvas.width / 16) - 1;
    let x = 0;

    for (let i = 0; i < 16; i++) {
      const barHeight = isPlaying ? (dataArray[i] / 255) * canvas.height : (Math.random() * 4 + 1);
      const grad = ctx.createLinearGradient(0, canvas.height, 0, 0);
      grad.addColorStop(0, '#00ff00');
      grad.addColorStop(0.65, '#ffff00');
      grad.addColorStop(1, '#ff0000');

      ctx.fillStyle = grad;
      ctx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);
      x += barWidth + 1;
    }

    requestAnimationFrame(drawSpectrum);
  }

  // Spline drawing with Catmull-Rom smoothing matching Nullsoft Winamp
  function drawEqSpline() {
    const canvas = document.getElementById('waEqSplineCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const sliders = document.querySelectorAll('.wa-vert-slider');
    if (!sliders.length) return;

    const points = [];
    sliders.forEach((slider, idx) => {
      const val = parseInt(slider.value) || 0;
      const x = (idx / (sliders.length - 1)) * (canvas.width - 4) + 2;
      const y = canvas.height / 2 - (val / 12) * (canvas.height / 2 - 2);
      points.push({ x, y });
    });

    ctx.beginPath();
    ctx.strokeStyle = '#00ff00';
    ctx.lineWidth = 1.2;

    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 0; i < points.length - 1; i++) {
      const xc = (points[i].x + points[i + 1].x) / 2;
      const yc = (points[i].y + points[i + 1].y) / 2;
      ctx.quadraticCurveTo(points[i].x, points[i].y, xc, yc);
    }
    ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y);
    ctx.stroke();
  }

  function loadAudioFile(event) {
    const file = event.target.files[0];
    if (!file) return;

    initAudioContext();
    stop();

    if (customAudioElement) customAudioElement.pause();
    customAudioElement = new Audio(URL.createObjectURL(file));

    if (!audioSourceNode) {
      audioSourceNode = audioCtx.createMediaElementSource(customAudioElement);
      audioSourceNode.connect(gainNode);
    }

    const title = file.name.replace(/\.[^/.]+$/, "");
    playlist.push({ title, duration: "03:40", isSynth: false });
    currentTrackIndex = playlist.length - 1;
    renderPlaylist();
    play();

    if (window.FirebaseSync) {
      window.FirebaseSync.backupSongs(playlist);
    }
  }

  function renderPlaylist() {
    const container = document.getElementById('playlistItems');
    if (!container) return;
    container.innerHTML = '';

    playlist.forEach((track, idx) => {
      const item = document.createElement('div');
      item.className = `wa-pl-item ${idx === currentTrackIndex ? 'active' : ''}`;
      item.innerHTML = `<span>${idx + 1}. ${track.title}</span> <span>${track.duration}</span>`;
      item.onclick = () => {
        stop();
        currentTrackIndex = idx;
        renderPlaylist();
        play();
      };
      container.appendChild(item);
    });

    const summary = document.getElementById('playlistTrackCount');
    if (summary) summary.innerText = `${playlist.length} tracks / 28:10`;
  }

  function restoreSongs(savedTracks) {
    if (Array.isArray(savedTracks) && savedTracks.length > 0) {
      playlist = savedTracks;
      renderPlaylist();
    }
  }

  return {
    init,
    play,
    pause,
    stop,
    next,
    prev,
    setVolume,
    setBalance,
    seek,
    toggleShuffle,
    toggleRepeat,
    toggleEq,
    togglePl,
    toggleEqOn,
    drawEqSpline,
    loadAudioFile,
    restoreSongs,
    getAudioContext: () => audioCtx
  };
})();
