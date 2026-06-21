/**
 * アプフェルローゼ 〜追憶のメロディ〜 - game.js
 * 縦スクロール・ローグライト弾幕シューティングゲーム
 */

// --- ゲーム状態定義 ---
const STATE = {
  TITLE: 'title',
  MENU: 'menu',
  STORY: 'story',
  PLAYING: 'playing',
  UPGRADE: 'upgrade',
  GAMEOVER: 'gameover',
  PAUSED: 'paused'
};

let gameState = STATE.TITLE;

// --- キャンバス設定 ---
const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
const WIDTH = canvas.width;
const HEIGHT = canvas.height;

// 仮想解像度での位置補正用
let scaleX = 1;
let scaleY = 1;

// --- オーディオシンセサイザー (Web Audio API) ---
class SoundSynth {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.bgmGain = null;
    this.seGain = null;
    this.bgmTimer = null;
    this.bgmIndex = 0;
    this.isPlayingBgm = false;
    this.tempo = 120; // BPM
    this.bgmType = 'normal'; // 'normal', 'boss', 'ending', 'menu'
    
    // 外部BGM用キャッシュとソース
    this.bgmBuffers = {};
    this.bgmSource = null;
    this.bgmLoadingStates = {
      menu: 'loading',
      normal: 'loading',
      boss: 'loading',
      ending: 'loading'
    };

    // ON/OFF状態の保持
    this.isBgmEnabled = true;
    this.isSeEnabled = true;

    // コード進行
    // 通常: Fmaj7 -> G7 -> Em7 -> Am7 (王道進行・エモい)
    this.chordsNormal = [
      [57, 60, 64, 67], // Fmaj7 (F, A, C, E)
      [59, 62, 65, 67], // G7 (G, B, D, F)
      [55, 59, 62, 64], // Em7 (E, G, B, D)
      [57, 60, 64, 69]  // Am7 (A, C, E, A)
    ];
    
    // ボス: Dm7 -> G7 -> Cmaj7 -> Am7
    this.chordsBoss = [
      [50, 53, 57, 60], // Dm7
      [55, 59, 62, 65], // G7
      [48, 52, 55, 59], // Cmaj7
      [57, 60, 64, 67]  // Am7
    ];

    // エンディング: C -> G/B -> Am -> Em/G -> F -> C/E -> Dm7 -> G7 (カノン進行風)
    this.chordsEnding = [
      [48, 52, 55, 60], // C
      [47, 50, 55, 59], // G
      [45, 48, 52, 57], // Am
      [43, 48, 52, 55], // Em
      [41, 45, 48, 53], // F
      [40, 43, 48, 52], // C
      [38, 41, 45, 50], // Dm
      [43, 47, 50, 55]  // G
    ];

    this.currentStep = 0;
  }

  init() {
    if (this.ctx) return;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AudioContextClass();
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.setValueAtTime(0.12, this.ctx.currentTime); // マスター音量を0.04から0.12に引き上げ（約3倍）
    this.masterGain.connect(this.ctx.destination);

    // BGM用ゲイン
    this.bgmGain = this.ctx.createGain();
    this.bgmGain.gain.setValueAtTime(this.isBgmEnabled ? 1.0 : 0.0, this.ctx.currentTime);
    this.bgmGain.connect(this.masterGain);

    // SE用ゲイン
    this.seGain = this.ctx.createGain();
    this.seGain.gain.setValueAtTime(this.isSeEnabled ? 1.0 : 0.0, this.ctx.currentTime);
    this.seGain.connect(this.masterGain);

    // BGMファイルのロード開始
    this.loadBgm('menu', 'audio/bgm_menu.mp3');
    this.loadBgm('normal', 'audio/bgm_normal.mp3');
    this.loadBgm('boss', 'audio/bgm_boss.mp3');
    this.loadBgm('ending', 'audio/bgm_ending.mp3');
  }

  // 外部BGMファイルの非同期ロード・デコード
  async loadBgm(key, url) {
    this.bgmLoadingStates[key] = 'loading';
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const arrayBuffer = await response.arrayBuffer();
      // デコード処理（ブラウザ環境のAudioContextで動作）
      const audioBuffer = await this.ctx.decodeAudioData(arrayBuffer);
      this.bgmBuffers[key] = audioBuffer;
      this.bgmLoadingStates[key] = 'loaded';
      console.log(`Loaded BGM: ${key} from ${url}`);

      // ロード完了時に、もし現在そのBGMが再生対象になっていれば再生開始
      if (this.isPlayingBgm && this.bgmType === key) {
        this.playBuffer(key);
      }
    } catch (e) {
      this.bgmLoadingStates[key] = 'failed';
      console.warn(`Could not load BGM [${key}] from ${url}:`, e.message);

      // ロード失敗時（未配置など）、もし現在そのBGMが再生対象なら自動合成で再生開始
      if (this.isPlayingBgm && this.bgmType === key) {
        this.currentStep = 0;
        this.runSequencer();
        console.log(`Fallback to synthesized BGM: ${key}`);
      }
    }
  }

  setBgmVolume(enabled) {
    this.isBgmEnabled = enabled;
    if (!this.bgmGain) return;
    this.bgmGain.gain.setValueAtTime(enabled ? 1.0 : 0.0, this.ctx.currentTime);
  }

  setSeVolume(enabled) {
    this.isSeEnabled = enabled;
    if (!this.seGain) return;
    this.seGain.gain.setValueAtTime(enabled ? 1.0 : 0.0, this.ctx.currentTime);
  }

  // BGMの開始
  startBgm(type = 'normal') {
    this.init();
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    
    if (this.bgmType === type && this.isPlayingBgm) {
      // 既に同じタイプのBGMが再生中の場合は何もしない
      return;
    }
    
    this.stopBgm(); // 現在再生中のBGM（シーケンサー含む）を一度停止
    this.bgmType = type;
    this.isPlayingBgm = true;
    
    const state = this.bgmLoadingStates[type];
    if (state === 'loaded' && this.bgmBuffers[type]) {
      this.playBuffer(type);
    } else if (state === 'failed') {
      // ロード失敗（ファイル未配置など）の場合は、従来のピコピコ自動合成シーケンサーを走らせる
      this.currentStep = 0;
      this.runSequencer();
      console.log(`Playing synthesized BGM (fallback): ${type}`);
    } else if (state === 'loading') {
      // ロード中の場合は、ロード完了時のイベントを待つ
      console.log(`BGM ${type} is still loading. Waiting...`);
    }
  }

  // デコード済みバッファを再生するヘルパー
  playBuffer(type) {
    if (this.bgmSource) return; // 二重再生防止
    this.bgmSource = this.ctx.createBufferSource();
    this.bgmSource.buffer = this.bgmBuffers[type];
    this.bgmSource.loop = true;
    this.bgmSource.connect(this.bgmGain);
    this.bgmSource.start(0);
    console.log(`Playing external BGM: ${type}`);
  }

  stopBgm() {
    this.isPlayingBgm = false;
    if (this.bgmTimer) {
      clearTimeout(this.bgmTimer);
      this.bgmTimer = null;
    }
    if (this.bgmSource) {
      try {
        this.bgmSource.stop();
      } catch (e) {
        // すでに停止している場合などのエラーを無視
      }
      this.bgmSource = null;
    }
  }

  // リアルタイム自動演奏シーケンサー
  runSequencer() {
    if (!this.isPlayingBgm || !this.ctx) return;

    const stepTime = 60 / this.tempo / 2; // 八分音符の秒数
    const now = this.ctx.currentTime;

    // 現在のコード進行を取得
    let chords = this.chordsNormal;
    if (this.bgmType === 'boss') chords = this.chordsBoss;
    else if (this.bgmType === 'ending') chords = this.chordsEnding;

    const chordIndex = Math.floor(this.currentStep / 8) % chords.length;
    const currentChord = chords[chordIndex];
    const subStep = this.currentStep % 8;

    // --- 1. ベース音 (ルート音) ---
    if (subStep === 0 || subStep === 4) {
      const rootNote = currentChord[0] - 12; // 1オクターブ下
      this.playSynthNode(rootNote, 'sawtooth', now, stepTime * 2, 0.4);
    }

    // --- 2. アルペジオ/伴奏 ---
    if (this.bgmType !== 'ending') {
      // 通常とボスは軽快なアルペジオ
      const noteToPlay = currentChord[subStep % currentChord.length];
      this.playSynthNode(noteToPlay, 'triangle', now, stepTime, 0.6);
    } else {
      // エンディングはオルゴール風で静か
      if (subStep % 2 === 0) {
        const noteToPlay = currentChord[subStep % currentChord.length] + 12; // 1オクターブ上
        this.playSynthNode(noteToPlay, 'sine', now, stepTime * 1.5, 0.5);
      }
    }

    // --- 3. メロディの自動生成 ---
    // コードトーンを中心に少し情緒的なメロディを紡ぐ
    if (subStep % 2 === 0 && Math.random() > 0.3) {
      let melodyOffset = 12; // 1オクターブ上
      if (this.bgmType === 'boss') melodyOffset = 12;
      const baseNote = currentChord[Math.floor(Math.random() * currentChord.length)] + melodyOffset;
      
      // 隣接するスケール音に少しだけズラす
      const scaleOffsets = [0, 2, -2, 4, -3];
      const finalNote = baseNote + scaleOffsets[Math.floor(Math.random() * scaleOffsets.length)];
      
      const waveType = this.bgmType === 'boss' ? 'sine' : 'triangle';
      const decay = this.bgmType === 'ending' ? stepTime * 2 : stepTime * 1.2;
      this.playSynthNode(finalNote, waveType, now, decay, 0.4);
    }

    this.currentStep++;
    
    // 次のステップを予約
    this.bgmTimer = setTimeout(() => {
      this.runSequencer();
    }, stepTime * 1000);
  }

  // 1音を合成して出力
  playSynthNode(midiNote, type, startTime, duration, volume) {
    if (!this.ctx) return;
    
    const osc = this.ctx.createOscillator();
    const gainNode = this.ctx.createGain();
    
    osc.type = type;
    osc.frequency.setValueAtTime(this.midiToFreq(midiNote), startTime);
    
    // 音量エンベロープ (フェードアウト)
    gainNode.gain.setValueAtTime(volume * 0.5, startTime);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
    
    osc.connect(gainNode);
    gainNode.connect(this.bgmGain);
    
    osc.start(startTime);
    osc.stop(startTime + duration);
  }

  midiToFreq(note) {
    return 440 * Math.pow(2, (note - 69) / 12);
  }

  // --- SE (効果音) 合成器 ---
  
  // 自機ショット音
  playLaser() {
    this.init();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gainNode = this.ctx.createGain();
    
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(800, now);
    osc.frequency.exponentialRampToValueAtTime(300, now + 0.1);
    
    gainNode.gain.setValueAtTime(0.15, now);
    gainNode.gain.linearRampToValueAtTime(0.001, now + 0.12);
    
    osc.connect(gainNode);
    gainNode.connect(this.seGain);
    
    osc.start(now);
    osc.stop(now + 0.12);
  }

  // 敵撃破音
  playExplosion() {
    this.init();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gainNode = this.ctx.createGain();
    
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(150, now);
    osc.frequency.exponentialRampToValueAtTime(10, now + 0.25);
    
    gainNode.gain.setValueAtTime(0.3, now);
    gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
    
    osc.connect(gainNode);
    gainNode.connect(this.seGain);
    
    osc.start(now);
    osc.stop(now + 0.28);
  }

  // かすり音（Graze）
  playGraze() {
    this.init();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gainNode = this.ctx.createGain();
    
    osc.type = 'sine';
    // キラキラした高音
    osc.frequency.setValueAtTime(1500, now);
    osc.frequency.linearRampToValueAtTime(2200, now + 0.05);
    
    gainNode.gain.setValueAtTime(0.2, now);
    gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
    
    osc.connect(gainNode);
    gainNode.connect(this.seGain);
    
    osc.start(now);
    osc.stop(now + 0.06);
  }

  // 被弾音
  playHit() {
    this.init();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gainNode = this.ctx.createGain();
    
    osc.type = 'square';
    osc.frequency.setValueAtTime(120, now);
    osc.frequency.setValueAtTime(50, now + 0.1);
    
    gainNode.gain.setValueAtTime(0.5, now);
    gainNode.gain.linearRampToValueAtTime(0.001, now + 0.2);
    
    osc.connect(gainNode);
    gainNode.connect(this.seGain);
    
    osc.start(now);
    osc.stop(now + 0.2);
  }

  // レベルアップ音
  playLevelUp() {
    this.init();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    
    // 3和音の高速アルペジオ
    const notes = [60, 64, 67, 72, 76, 79]; // Cコードの上昇音
    notes.forEach((note, index) => {
      const triggerTime = now + index * 0.06;
      const osc = this.ctx.createOscillator();
      const gainNode = this.ctx.createGain();
      
      osc.type = 'sine';
      osc.frequency.setValueAtTime(this.midiToFreq(note), triggerTime);
      
      gainNode.gain.setValueAtTime(0.25, triggerTime);
      gainNode.gain.exponentialRampToValueAtTime(0.001, triggerTime + 0.25);
      
      osc.connect(gainNode);
      gainNode.connect(this.seGain);
      
      osc.start(triggerTime);
      osc.stop(triggerTime + 0.25);
    });
  }

  // ボム発動音
  playBomb() {
    this.init();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    
    // 超低音の爆発ノイズ風スイープ
    const osc = this.ctx.createOscillator();
    const gainNode = this.ctx.createGain();
    
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(300, now);
    osc.frequency.exponentialRampToValueAtTime(40, now + 0.6);
    
    gainNode.gain.setValueAtTime(0.4, now);
    gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.7);
    
    osc.connect(gainNode);
    gainNode.connect(this.seGain);
    
    osc.start(now);
    osc.stop(now + 0.7);
  }
}

const audio = new SoundSynth();

// --- 背景スクロール ---
class Starfield {
  constructor() {
    this.stars = [];
    this.init();
  }

  init() {
    this.stars = [];
    // 3レイヤー分の星を生成
    for (let i = 0; i < 70; i++) {
      this.stars.push({
        x: Math.random() * WIDTH,
        y: Math.random() * HEIGHT,
        size: Math.random() * 1.5 + 0.5,
        speed: Math.random() * 1.5 + 0.5, // 遅い
        layer: 1,
        color: 'rgba(255, 255, 255, 0.3)'
      });
    }
    for (let i = 0; i < 40; i++) {
      this.stars.push({
        x: Math.random() * WIDTH,
        y: Math.random() * HEIGHT,
        size: Math.random() * 2 + 1,
        speed: Math.random() * 2.5 + 1.5, // 中速
        layer: 2,
        color: 'rgba(5, 249, 226, 0.5)'
      });
    }
    for (let i = 0; i < 15; i++) {
      this.stars.push({
        x: Math.random() * WIDTH,
        y: Math.random() * HEIGHT,
        size: Math.random() * 3 + 1.5,
        speed: Math.random() * 4.5 + 3, // 高速
        layer: 3,
        color: 'rgba(255, 42, 133, 0.6)'
      });
    }
  }

  update(dt) {
    this.stars.forEach(star => {
      star.y += star.speed * 60 * dt;
      if (star.y > HEIGHT) {
        star.y = 0;
        star.x = Math.random() * WIDTH;
      }
    });
  }

  draw() {
    this.stars.forEach(star => {
      ctx.fillStyle = star.color;
      ctx.beginPath();
      ctx.arc(star.x, star.y, star.size, 0, Math.PI * 2);
      ctx.fill();
    });
  }
}

const starfield = new Starfield();

// --- プレイヤー（自機）クラス ---
class Player {
  constructor() {
    this.x = WIDTH / 2;
    this.y = HEIGHT - 120;
    this.radius = 12;        // 見た目の半径
    this.hurtRadius = 2.5;    // 当たり判定（ドット）の半径
    this.grazeRadius = 22;   // かすり判定の半径
    this.speed = 320;        // 秒間移動ピクセル数

    this.maxHp = 3;
    this.hp = this.maxHp;
    this.maxBombs = 3;
    this.bombs = 2;
    
    this.invulnerableTime = 0; // 無敵残り時間（秒）
    this.shieldActive = false;
    this.shieldTimer = 0;      // バリア再充填タイマー
    this.shieldCooldown = 15;  // バリア自動回復間隔（秒）

    // スキルレベル
    this.level = 1;
    this.xp = 0;
    this.xpNeeded = 100;
    this.grazeCount = 0;

    // 強化レベル (0 = 未開放, 1+ = レベル)
    this.skills = {
      shot: 1,      // ほうきショット（メイン弾数、拡散）
      laser: 0,     // はたきレーザー（前方貫通）
      teaBomb: 0,   // ティーカップボム（爆発お皿弾）
      homing: 0,    // オートモップ（追尾弾）
      magnet: 1,    // 吸引力（アイテム吸い寄せ）
      shield: 0     // シールド（被弾無効）
    };

    this.shootTimer = 0;
    this.shootInterval = 0.12; // 秒間連射速度
  }

  reset() {
    this.x = WIDTH / 2;
    this.y = HEIGHT - 120;
    this.hp = this.maxHp;
    this.bombs = 2;
    this.invulnerableTime = 1.5; // リスポーン無敵
    this.level = 1;
    this.xp = 0;
    this.xpNeeded = 100;
    this.grazeCount = 0;
    this.shieldActive = false;
    this.shieldTimer = 0;

    // スキル初期化
    for (let key in this.skills) {
      this.skills[key] = (key === 'shot' || key === 'magnet') ? 1 : 0;
    }
  }

  update(dt, keys) {
    // 1. 移動処理
    let dx = 0;
    let dy = 0;

    if (joystick.active) {
      // ジョイスティック移動
      const jdx = joystick.currentX - joystick.startX;
      const jdy = joystick.currentY - joystick.startY;
      const dist = Math.hypot(jdx, jdy);
      
      if (dist > 2) {
        const speedMultiplier = Math.min(1, dist / joystick.maxRadius);
        dx = (jdx / dist) * speedMultiplier;
        dy = (jdy / dist) * speedMultiplier;
        
        this.x += dx * this.speed * dt;
        this.y += dy * this.speed * dt;
      }
    } else {
      // キーボード移動
      if (keys['KeyA'] || keys['ArrowLeft']) dx = -1;
      if (keys['KeyD'] || keys['ArrowRight']) dx = 1;
      if (keys['KeyW'] || keys['ArrowUp']) dy = -1;
      if (keys['KeyS'] || keys['ArrowDown']) dy = 1;

      if (dx !== 0 && dy !== 0) {
        // 斜め移動の正規化
        dx *= 0.7071;
        dy *= 0.7071;
      }

      this.x += dx * this.speed * dt;
      this.y += dy * this.speed * dt;
    }

    // 画面外はみ出し制限
    this.x = Math.max(this.radius, Math.min(WIDTH - this.radius, this.x));
    this.y = Math.max(this.radius, Math.min(HEIGHT - this.radius, this.y));

    // 2. 無敵時間更新
    if (this.invulnerableTime > 0) {
      this.invulnerableTime -= dt;
    }

    // 3. バリアの自動回復
    if (this.skills.shield > 0 && !this.shieldActive) {
      this.shieldTimer += dt;
      if (this.shieldTimer >= this.shieldCooldown) {
        this.shieldActive = true;
        this.shieldTimer = 0;
        audio.playGraze(); // シールド復旧通知のキラキラ音
      }
    }

    // 4. ショットの発射
    this.shootTimer += dt;
    if (this.shootTimer >= this.shootInterval) {
      this.shoot();
      this.shootTimer = 0;
    }
  }

  shoot() {
    audio.playLaser();
    
    // --- スキル1: ほうきショット (メイン) ---
    const lv = this.skills.shot;
    if (lv === 1) {
      bullets.push(new PlayerBullet(this.x, this.y - 10, 0, -600, 'shot'));
    } else if (lv === 2) {
      bullets.push(new PlayerBullet(this.x - 6, this.y - 10, 0, -600, 'shot'));
      bullets.push(new PlayerBullet(this.x + 6, this.y - 10, 0, -600, 'shot'));
    } else if (lv >= 3) {
      // 3Way以上の連射
      bullets.push(new PlayerBullet(this.x, this.y - 10, 0, -600, 'shot'));
      bullets.push(new PlayerBullet(this.x - 8, this.y - 8, -80, -580, 'shot'));
      bullets.push(new PlayerBullet(this.x + 8, this.y - 8, 80, -580, 'shot'));
      if (lv >= 4) {
        bullets.push(new PlayerBullet(this.x - 14, this.y - 5, -160, -550, 'shot'));
        bullets.push(new PlayerBullet(this.x + 14, this.y - 5, 160, -550, 'shot'));
      }
    }

    // --- スキル2: はたきレーザー ---
    if (this.skills.laser > 0) {
      const laserLv = this.skills.laser;
      bullets.push(new PlayerBullet(this.x, this.y - 20, 0, -800, 'laser', laserLv));
    }

    // --- スキル3: ティーカップボム ---
    if (this.skills.teaBomb > 0 && Math.random() < 0.4) {
      const angle = (Math.random() - 0.5) * 0.4;
      bullets.push(new PlayerBullet(this.x, this.y - 15, Math.sin(angle) * 400, -400, 'teabomb', this.skills.teaBomb));
    }

    // --- スキル4: オートモップ (ホーミング) ---
    if (this.skills.homing > 0 && Math.random() < 0.3) {
      bullets.push(new PlayerBullet(this.x, this.y, 0, -300, 'homing', this.skills.homing));
    }
  }

  // ボム（大掃除）発動
  useBomb() {
    if (this.bombs <= 0) return false;
    this.bombs--;
    audio.playBomb();
    triggerBombEffect();
    return true;
  }

  // 被弾時の処理
  hit() {
    if (this.invulnerableTime > 0) return false;

    // シールドがある場合
    if (this.shieldActive) {
      this.shieldActive = false;
      this.shieldTimer = 0;
      this.invulnerableTime = 1.0; // 短い無敵
      audio.playGraze(); // バリアで防いだキラキラ音
      triggerDamageFlash(true); // バリア被弾の青フラッシュ
      return false;
    }

    // 被弾
    this.hp--;
    this.invulnerableTime = 2.0; // 2秒無敵
    audio.playHit();
    triggerDamageFlash(false); // ダメージの赤フラッシュ
    
    // スコアペナルティ (少しだけ)
    score = Math.max(0, score - 500);
    
    if (this.hp <= 0) {
      endGame();
    }
    return true;
  }

  gainXp(amount) {
    this.xp += amount;
    if (this.xp >= this.xpNeeded) {
      this.xp -= this.xpNeeded;
      this.levelUp();
    }
  }

  levelUp() {
    this.level++;
    this.xpNeeded = Math.floor(100 + this.level * 45); // 必要経験値アップ
    audio.playLevelUp();
    
    // レベルアップと同時にボムゲージやHPを少し優遇
    if (this.level % 3 === 0) {
      this.bombs = Math.min(this.maxBombs, this.bombs + 1);
    }
    
    // ゲームを一時停止してカード選択状態へ
    gameState = STATE.UPGRADE;
    showUpgradeOverlay();
  }

  draw() {
    ctx.save();
    
    // 被弾無敵の点滅
    if (this.invulnerableTime > 0 && Math.floor(Date.now() / 60) % 2 === 0) {
      ctx.globalAlpha = 0.3;
    }

    // 1. バリアエフェクト
    if (this.shieldActive) {
      ctx.strokeStyle = 'rgba(5, 249, 226, 0.6)';
      ctx.lineWidth = 2;
      ctx.shadowBlur = 10;
      ctx.shadowColor = varColor('--neon-cyan');
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.grazeRadius - 2, 0, Math.PI * 2);
      ctx.stroke();
      
      // シールド内の薄い塗り
      ctx.fillStyle = 'rgba(5, 249, 226, 0.05)';
      ctx.fill();
    }

    // 2. ロザリー・スカーレットの描画 (ベクターアート・お嬢様仕様)
    // 後ろ髪 (金髪)
    ctx.fillStyle = '#fcd057';
    ctx.beginPath();
    ctx.arc(this.x, this.y + 4, 12, 0, Math.PI * 2);
    ctx.fill();

    // 頭部・前髪 (金髪)
    ctx.beginPath();
    ctx.arc(this.x, this.y - 4, 10, 0, Math.PI * 2);
    ctx.fill();

    // 顔 (肌色)
    ctx.fillStyle = '#fce2c4';
    ctx.beginPath();
    ctx.arc(this.x, this.y - 2, 8, 0, Math.PI * 2);
    ctx.fill();

    // 薔薇の髪飾り (赤)
    ctx.fillStyle = '#d3003f';
    ctx.beginPath();
    ctx.arc(this.x + 8, this.y - 10, 3, 0, Math.PI * 2);
    ctx.arc(this.x - 8, this.y - 10, 3, 0, Math.PI * 2);
    ctx.fill();

    // 服 (赤いドレス)
    ctx.fillStyle = '#c00030';
    ctx.beginPath();
    ctx.moveTo(this.x - 11, this.y + 12);
    ctx.lineTo(this.x + 11, this.y + 12);
    ctx.lineTo(this.x + 6, this.y - 2);
    ctx.lineTo(this.x - 6, this.y - 2);
    ctx.closePath();
    ctx.fill();

    // フリルセンター (白)
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(this.x - 4, this.y + 12);
    ctx.lineTo(this.x + 4, this.y + 12);
    ctx.lineTo(this.x + 2, this.y + 2);
    ctx.lineTo(this.x - 2, this.y + 2);
    ctx.closePath();
    ctx.fill();

    // 飾り (ゴールド)
    ctx.fillStyle = '#ffd700';
    ctx.beginPath();
    ctx.arc(this.x, this.y + 4, 2, 0, Math.PI * 2);
    ctx.fill();

    // 3. 自機かすり判定（薄い円）
    ctx.strokeStyle = 'rgba(31, 81, 255, 0.15)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.grazeRadius, 0, Math.PI * 2);
    ctx.stroke();

    // 4. 自機当たり判定コア（ネオンに輝くドット）
    ctx.shadowBlur = 10;
    ctx.shadowColor = varColor('--neon-cyan');
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.hurtRadius, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }
}

// ヘルパー: CSS変数から色値を取得
function varColor(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// --- プレイヤー弾クラス ---
class PlayerBullet {
  constructor(x, y, vx, vy, type, level = 1) {
    this.x = x;
    this.y = y;
    this.vx = vx;
    this.vy = vy;
    this.type = type; // 'shot', 'laser', 'teabomb', 'homing'
    this.level = level;

    // タイプごとの設定
    this.dead = false;
    this.damage = 1;
    
    if (this.type === 'shot') {
      this.radius = 5;
      this.color = varColor('--neon-cyan');
      this.damage = 1 + (level * 0.2);
    } else if (this.type === 'laser') {
      this.width = 12 + level * 4;
      this.height = 100;
      this.color = 'rgba(5, 249, 226, 0.8)';
      this.damage = 0.5; // レーザーはフレームあたり多段ヒット
    } else if (this.type === 'teabomb') {
      this.radius = 10;
      this.color = varColor('--neon-yellow');
      this.damage = 3;
    } else if (this.type === 'homing') {
      this.radius = 4;
      this.color = varColor('--neon-pink');
      this.damage = 0.8;
      this.target = null;
    }
  }

  update(dt) {
    if (this.type === 'laser') {
      // レーザーは自機に追従
      this.x = player.x;
      this.y = player.y - this.height / 2 - 20;
      if (player.invulnerableTime > 0 && Math.floor(Date.now() / 60) % 2 === 0) {
        this.dead = true; // 無敵中はレーザー出ない
      }
    } else if (this.type === 'homing') {
      // ターゲット追従
      if (!this.target || this.target.dead) {
        this.findTarget();
      }
      if (this.target) {
        const dx = this.target.x - this.x;
        const dy = this.target.y - this.y;
        const dist = Math.hypot(dx, dy);
        if (dist > 5) {
          const speed = 500;
          this.vx = (dx / dist) * speed;
          this.vy = (dy / dist) * speed;
        }
      } else {
        // 敵がいない場合は即消去（旋回し続けるのを防ぐ）
        this.dead = true;
        return;
      }
      this.x += this.vx * dt;
      this.y += this.vy * dt;
    } else {
      // 通常弾・ボム皿弾の直線移動
      this.x += this.vx * dt;
      this.y += this.vy * dt;
    }

    // 画面外判定
    if (this.x < -50 || this.x > WIDTH + 50 || this.y < -120 || this.y > HEIGHT + 50) {
      this.dead = true;
    }
  }

  findTarget() {
    let minDist = 9999;
    enemies.forEach(e => {
      if (e.dead) return;
      const d = Math.hypot(e.x - this.x, e.y - this.y);
      if (d < minDist) {
        minDist = d;
        this.target = e;
      }
    });
  }

  draw() {
    ctx.save();
    ctx.shadowBlur = 6;
    ctx.shadowColor = this.color;

    if (this.type === 'laser') {
      // 縦レーザー光線
      ctx.fillStyle = this.color;
      ctx.fillRect(this.x - this.width / 2, this.y - this.height / 2, this.width, this.height);
      
      // 内側の白い芯
      ctx.fillStyle = '#fff';
      ctx.fillRect(this.x - this.width / 4, this.y - this.height / 2, this.width / 2, this.height);
    } else if (this.type === 'teabomb') {
      // ティーカップの描画
      ctx.fillStyle = this.color;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.radius, 0, Math.PI, false);
      ctx.fill();
      
      // 取っ手
      ctx.strokeStyle = this.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(this.x + this.radius, this.y - 2, 4, -Math.PI/2, Math.PI/2);
      ctx.stroke();
    } else {
      // 通常丸弾
      ctx.fillStyle = this.color;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  explode() {
    this.dead = true;
    if (this.type === 'teabomb') {
      audio.playExplosion();
      // 爆風パーティクルを拡散
      for (let i = 0; i < 16; i++) {
        const angle = (i / 16) * Math.PI * 2;
        const speed = 100 + Math.random() * 80;
        // ティーカップ爆風を小さな弾丸として放つ
        bullets.push(new PlayerBullet(this.x, this.y, Math.cos(angle) * speed, Math.sin(angle) * speed, 'shot', 1));
      }
    }
  }
}

// --- 敵弾クラス ---
class EnemyBullet {
  constructor(x, y, vx, vy, color = '#ff2a85', radius = 4) {
    this.x = x;
    this.y = y;
    this.vx = vx;
    this.vy = vy;
    this.color = color;
    this.radius = radius;
    this.dead = false;
    this.grazed = false; // すでに自機にかすり済みのフラグ
  }

  update(dt) {
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    if (this.x < -20 || this.x > WIDTH + 20 || this.y < -20 || this.y > HEIGHT + 20) {
      this.dead = true;
    }
  }

  draw() {
    ctx.save();
    ctx.shadowBlur = 8;
    ctx.shadowColor = this.color;
    ctx.fillStyle = '#ffffff'; // 中心は白く輝く
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = this.color;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  }
}

// --- 敵機クラス ---
class Enemy {
  constructor(x, y, type) {
    this.x = x;
    this.y = y;
    this.type = type; // 'dust' (弱い・直線), 'clock' (中・扇状射撃), 'cup' (中・狙い撃ち), 'boss' (大ボス)
    this.dead = false;
    this.shootTimer = Math.random();

    // ステータス
    if (type === 'dust') {
      this.radius = 12;
      this.hp = 1.5;
      this.color = varColor('--neon-purple');
      this.vy = 80;
      this.vx = 0;
      this.shootInterval = 2.0;
    } else if (type === 'clock') {
      this.radius = 16;
      this.hp = 5;
      this.color = varColor('--neon-pink');
      this.vy = 40;
      this.vx = (Math.random() - 0.5) * 40;
      this.shootInterval = 1.5;
    } else if (type === 'cup') {
      this.radius = 15;
      this.hp = 4;
      this.color = varColor('--neon-yellow');
      this.vy = 50;
      this.vx = (x < WIDTH / 2) ? 30 : -30;
      this.shootInterval = 1.8;
    } else if (type === 'boss') {
      this.radius = 45;
      this.hp = 120; // ボス体力
      this.maxHp = 120;
      this.color = varColor('--neon-pink');
      this.vy = 40; // 画面上部までゆっくり降りる
      this.vx = 0;
      this.bossPhase = 1;
      this.shootInterval = 0.8;
      this.moveTimer = 0;
    }
  }

  update(dt) {
    // 移動
    if (this.type === 'boss') {
      // ボス特有の移動
      if (this.y < 120) {
        this.y += this.vy * dt;
      } else {
        // 画面上部で左右に揺行
        this.moveTimer += dt;
        this.x = WIDTH / 2 + Math.sin(this.moveTimer * 0.8) * 120;
      }
    } else {
      // 雑魚の移動
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      
      // 左右の反射
      if (this.x < this.radius || this.x > WIDTH - this.radius) {
        this.vx *= -1;
      }
    }

    // 画面外脱出 (ボス以外)
    if (this.type !== 'boss' && this.y > HEIGHT + 30) {
      this.dead = true;
    }

    // ショット発射
    this.shootTimer += dt;
    if (this.shootTimer >= this.shootInterval) {
      this.shoot();
      this.shootTimer = 0;
    }
  }

  shoot() {
    if (this.dead || this.y < 30) return;

    if (this.type === 'dust') {
      // 単発自機狙い
      const angle = Math.atan2(player.y - this.y, player.x - this.x);
      enemyBullets.push(new EnemyBullet(this.x, this.y, Math.cos(angle) * 180, Math.sin(angle) * 180, this.color, 4));
    } else if (this.type === 'clock') {
      // 3Way扇状射撃
      const baseAngle = Math.atan2(player.y - this.y, player.x - this.x);
      const spreads = [-0.25, 0, 0.25];
      spreads.forEach(ofs => {
        const ang = baseAngle + ofs;
        enemyBullets.push(new EnemyBullet(this.x, this.y, Math.cos(ang) * 160, Math.sin(ang) * 160, this.color, 5));
      });
    } else if (this.type === 'cup') {
      // 回転交差弾
      const count = 6;
      const step = (Math.PI * 2) / count;
      const angleOffset = Date.now() / 1000; // 時間経過で回転
      for (let i = 0; i < count; i++) {
        const ang = step * i + angleOffset;
        enemyBullets.push(new EnemyBullet(this.x, this.y, Math.cos(ang) * 140, Math.sin(ang) * 140, this.color, 4));
      }
    } else if (this.type === 'boss') {
      this.bossShoot();
    }
  }

  // ボスの弾幕パターン (フェーズによって変化)
  bossShoot() {
    const hpRatio = this.hp / this.maxHp;
    
    // フェーズ判定
    if (hpRatio > 0.6) {
      // フェーズ 1: 円形放射弾（リング弾）
      const count = 16;
      const step = (Math.PI * 2) / count;
      const angleOffset = Date.now() / 2000; // ゆっくり回転
      for (let i = 0; i < count; i++) {
        const ang = step * i + angleOffset;
        enemyBullets.push(new EnemyBullet(this.x, this.y, Math.cos(ang) * 150, Math.sin(ang) * 150, '#ffe600', 4.5));
      }
    } else if (hpRatio > 0.3) {
      // フェーズ 2: 狙い撃ちスパイラル（渦巻き）
      const count = 3;
      const angleOffset = (Date.now() / 400) % (Math.PI * 2);
      for (let i = 0; i < count; i++) {
        const ang = angleOffset + (i * Math.PI * 2 / count);
        enemyBullets.push(new EnemyBullet(this.x, this.y, Math.cos(ang) * 200, Math.sin(ang) * 200, '#05f9e2', 4));
      }
      
      // 追加で自機狙いを定期的に
      if (Math.random() < 0.4) {
        const ang = Math.atan2(player.y - this.y, player.x - this.x);
        enemyBullets.push(new EnemyBullet(this.x, this.y, Math.cos(ang) * 250, Math.sin(ang) * 250, '#ff2a85', 5));
      }
    } else {
      // フェーズ 3: 全方位大激化 (狂暴化パターン)
      const count = 12;
      const step = (Math.PI * 2) / count;
      // 左右にねじれるような全方位弾
      const angleOffset = Math.sin(Date.now() / 300) * 0.8;
      for (let i = 0; i < count; i++) {
        const ang = step * i + angleOffset;
        enemyBullets.push(new EnemyBullet(this.x, this.y, Math.cos(ang) * 180, Math.sin(ang) * 180, '#ff2a85', 4));
      }
      for (let i = 0; i < count; i++) {
        const ang = step * i - angleOffset + 0.1;
        enemyBullets.push(new EnemyBullet(this.x, this.y, Math.cos(ang) * 140, Math.sin(ang) * 140, '#bd00ff', 4.5));
      }
    }
  }

  damage(amount) {
    if (this.dead) return;
    this.hp -= amount;
    if (this.hp <= 0) {
      this.dead = true;
      audio.playExplosion();
      score += this.type === 'boss' ? 20000 : (this.type === 'dust' ? 100 : 300);
      
      // 撃破パーティクル
      createExplosionParticles(this.x, this.y, this.color, this.type === 'boss' ? 40 : 10);

      // ドロップ（経験値/回復）
      if (this.type === 'boss') {
        // ボス撃破時は大量のXPとライフ回復
        for (let i = 0; i < 25; i++) {
          xpItems.push(new XpItem(this.x + (Math.random()-0.5)*50, this.y + (Math.random()-0.5)*50, 10));
        }
        xpItems.push(new XpItem(this.x, this.y, 50, true)); // ライフ回復アイテム
        
        // ボス撃破後のストーリーへ
        setTimeout(() => {
          stopGameForStory(STORY_EVENTS.BOSS_DEFEATED);
        }, 1500);
      } else {
        // 雑魚は確率でXP
        const num = Math.random() < 0.3 ? 2 : 1;
        for (let i = 0; i < num; i++) {
          xpItems.push(new XpItem(this.x + (Math.random() - 0.5) * 10, this.y + (Math.random() - 0.5) * 10));
        }
        // 低確率でライフ回復
        if (Math.random() < 0.04) {
          xpItems.push(new XpItem(this.x, this.y, 10, true));
        }
      }
    }
  }

  draw() {
    ctx.save();
    ctx.shadowBlur = 10;
    ctx.shadowColor = this.color;

    if (this.type === 'dust') {
      // ゴミ・埃ノイズ (四角形の崩れたエフェクト)
      ctx.fillStyle = this.color;
      ctx.beginPath();
      ctx.rect(this.x - 8, this.y - 8, 16, 16);
      ctx.fill();
      
      // 回るデコ
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1;
      ctx.strokeRect(this.x - 11, this.y - 11, 22, 22);
    } else if (this.type === 'clock') {
      // 壊れた時計 (円形に針)
      ctx.fillStyle = '#101530';
      ctx.strokeStyle = this.color;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // 針
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(this.x, this.y);
      ctx.lineTo(this.x + 8, this.y - 4);
      ctx.moveTo(this.x, this.y);
      ctx.lineTo(this.x - 2, this.y + 10);
      ctx.stroke();
    } else if (this.type === 'cup') {
      // 壊れたカップ
      ctx.fillStyle = '#101530';
      ctx.strokeStyle = this.color;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.radius, 0, Math.PI, true);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // ひび割れ
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(this.x - 5, this.y - 5);
      ctx.lineTo(this.x + 2, this.y + 4);
      ctx.stroke();
    } else if (this.type === 'boss') {
      // 巨大ノイズコア（ボスの描画）
      ctx.fillStyle = 'rgba(7, 10, 25, 0.9)';
      ctx.strokeStyle = this.color;
      ctx.lineWidth = 5;
      
      // 幾何学的な外郭
      ctx.beginPath();
      const sides = 8;
      const angleStep = (Math.PI * 2) / sides;
      const pulseRadius = this.radius + Math.sin(Date.now() / 150) * 4;
      for (let i = 0; i <= sides; i++) {
        const x = this.x + Math.cos(angleStep * i) * pulseRadius;
        const y = this.y + Math.sin(angleStep * i) * pulseRadius;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.fill();
      ctx.stroke();

      // 内側のネオンコア
      ctx.fillStyle = varColor('--neon-pink');
      ctx.beginPath();
      ctx.arc(this.x, this.y, 18 + Math.cos(Date.now() / 100) * 3, 0, Math.PI * 2);
      ctx.fill();
      
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(this.x, this.y, 8, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }
}

// --- 経験値（記憶の欠片）＆回復アイテムクラス ---
class XpItem {
  constructor(x, y, xpValue = 10, isHeal = false) {
    this.x = x;
    this.y = y;
    this.xpValue = xpValue;
    this.isHeal = isHeal; // ライフ回復かどうか
    this.dead = false;

    this.radius = isHeal ? 8 : 4;
    this.color = isHeal ? varColor('--neon-pink') : varColor('--neon-cyan');

    // 初速度（少し散る）
    const ang = Math.random() * Math.PI * 2;
    const speed = Math.random() * 80 + 20;
    this.vx = Math.cos(ang) * speed;
    this.vy = Math.sin(ang) * speed - 40; // 上へ吹き出す
  }

  update(dt) {
    // 摩擦抵抗
    this.vx *= 0.95;
    this.vy = (this.vy + 200 * dt) * 0.95; // 重力落下

    // プレイヤーへの吸い寄せ（磁石スキル）
    const dx = player.x - this.x;
    const dy = player.y - this.y;
    const dist = Math.hypot(dx, dy);

    // 吸い込み範囲 (磁石レベル依存)
    const magnetRange = 80 + player.skills.magnet * 45;
    if (dist < magnetRange) {
      const pullSpeed = 400 + (player.skills.magnet * 50);
      this.vx = (dx / dist) * pullSpeed;
      this.vy = (dy / dist) * pullSpeed;
    }

    this.x += this.vx * dt;
    this.y += this.vy * dt;

    // 画面外消滅（下のみ）
    if (this.y > HEIGHT + 20) {
      this.dead = true;
    }

    // プレイヤーとの衝突
    if (dist < player.radius + this.radius) {
      this.dead = true;
      if (this.isHeal) {
        player.hp = Math.min(player.maxHp, player.hp + 1);
        audio.playGraze(); // シャララ音
      } else {
        player.gainXp(this.xpValue);
        score += this.xpValue * 10;
        audio.playGraze();
      }
    }
  }

  draw() {
    ctx.save();
    ctx.shadowBlur = 8;
    ctx.shadowColor = this.color;
    ctx.fillStyle = this.color;

    if (this.isHeal) {
      // ハートマークを描画
      ctx.beginPath();
      const x = this.x, y = this.y - 3;
      ctx.moveTo(x, y);
      ctx.bezierCurveTo(x - 6, y - 6, x - 12, y + 2, x, y + 10);
      ctx.bezierCurveTo(x + 12, y + 2, x + 6, y - 6, x, y);
      ctx.fill();
    } else {
      // 記憶のリンゴ（赤リンゴ・葉っぱ付き）
      ctx.fillStyle = '#ff2a55'; // ネオンレッド
      ctx.beginPath();
      ctx.arc(this.x - 2, this.y, 4, 0, Math.PI * 2);
      ctx.arc(this.x + 2, this.y, 4, 0, Math.PI * 2);
      ctx.fill();
      
      // 茎 (茶色)
      ctx.strokeStyle = '#8b5a2b';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(this.x, this.y - 2);
      ctx.quadraticCurveTo(this.x + 1, this.y - 5, this.x + 2, this.y - 7);
      ctx.stroke();

      // 葉っぱ (緑)
      ctx.fillStyle = '#00ff66';
      ctx.beginPath();
      ctx.ellipse(this.x + 2, this.y - 6, 2, 1, Math.PI / 4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

// --- パーティクルクラス ---
class Particle {
  constructor(x, y, color, size = 3, vx = 0, vy = 0, life = 0.5) {
    this.x = x;
    this.y = y;
    this.color = color;
    this.size = size;
    this.vx = vx || (Math.random() - 0.5) * 150;
    this.vy = vy || (Math.random() - 0.5) * 150;
    this.life = life; // 残り寿命（秒）
    this.maxLife = life;
    this.dead = false;
  }

  update(dt) {
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.life -= dt;
    if (this.life <= 0) {
      this.dead = true;
    }
  }

  draw() {
    ctx.save();
    ctx.fillStyle = this.color;
    ctx.globalAlpha = this.life / this.maxLife;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

// --- グローバル変数 & コレクション ---
const player = new Player();
let bullets = [];
let enemyBullets = [];
let enemies = [];
let xpItems = [];
let particles = [];

let score = 0;
let grazeCount = 0;
let waveCount = 1;
let timeCount = 0;

let activeKeys = {};
let isMobile = false;

// ジョイスティック管理
let joystick = {
  active: false,
  startX: 0,
  startY: 0,
  currentX: 0,
  currentY: 0,
  maxRadius: 60,
  touchId: null,
  isMouse: false
};

// 警告・揺れ管理
let isWarningActive = false;
let warningTimer = 0;
let shakeAmount = 0;

// --- Supabase ランキング設定 ---
const SUPABASE_URL = 'https://neofsloblcneynwaqslx.supabase.co';
const SUPABASE_KEY = 'sb_publishable_EQZVMm1XnMzYxFupYOYMmA_lhucBoNR';
const SUPABASE_TABLE = 'apfelrose_rankings';
const SUPABASE_HEADERS = {
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json'
};

// --- ストーリーイベント・テキストデータ ---
const STORY_EVENTS = {
  INTRO: 'intro',
  WAVE_ALERT: 'wave_alert',
  BOSS_WARNING: 'boss_warning',
  BOSS_DEFEATED: 'boss_defeated'
};




let currentStoryList = [];
let currentStoryIndex = 0;
let typingTimer = null;
let displayedText = "";
let fullTextTarget = "";

// --- ゲームバランス・ウェーブ管理 ---
let waveSpawners = [
  // ウェーブ1: 簡単なゴミ
  {
    time: 2,
    action: () => spawnEnemyGroup('dust', 3)
  },
  {
    time: 8,
    action: () => spawnEnemyGroup('dust', 4)
  },
  // ウェーブ2: 中間ノイズ出現 (ストーリー挟む)
  {
    time: 15,
    action: () => {
      stopGameForStory(STORY_EVENTS.WAVE_ALERT);
    }
  },
  {
    time: 17,
    action: () => {
      spawnEnemyGroup('clock', 2);
      spawnEnemyGroup('dust', 3);
    }
  },
  {
    time: 28,
    action: () => {
      spawnEnemyGroup('cup', 2);
      spawnEnemyGroup('clock', 1);
    }
  },
  // ウェーブ3: 混戦
  {
    time: 38,
    action: () => {
      spawnEnemyGroup('dust', 5);
      spawnEnemyGroup('cup', 2);
    }
  },
  // ボス出現 (ストーリー挟む)
  {
    time: 50,
    action: () => {
      stopGameForStory(STORY_EVENTS.BOSS_WARNING);
    }
  },
  {
    time: 52,
    action: () => {
      // 巨大ボス出現
      isWarningActive = true;
      warningTimer = 3.0; // 3秒警告
      setTimeout(() => {
        isWarningActive = false;
        enemies.push(new Enemy(WIDTH / 2, -50, 'boss'));
        document.getElementById('boss-hud').classList.remove('hidden');
      }, 3000);
    }
  }
];

let activeSpawners = [];

function spawnEnemyGroup(type, count) {
  for (let i = 0; i < count; i++) {
    const x = 50 + Math.random() * (WIDTH - 100);
    const y = -30 - (i * 25); // 縦にずらして出現
    enemies.push(new Enemy(x, y, type));
  }
}

// --- パーティクルエフェクトヘルパー ---
function createExplosionParticles(x, y, color, count = 10) {
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = Math.random() * 200 + 50;
    const size = Math.random() * 4 + 1.5;
    const life = Math.random() * 0.4 + 0.2;
    particles.push(new Particle(
      x, y, 
      color, 
      size, 
      Math.cos(angle) * speed, 
      Math.sin(angle) * speed, 
      life
    ));
  }
}

function createGrazeSparkle(x, y) {
  // 自機かすり時の火花
  for (let i = 0; i < 3; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = Math.random() * 100 + 40;
    particles.push(new Particle(
      x, y, 
      '#05f9e2', 
      1.5, 
      Math.cos(angle) * speed, 
      Math.sin(angle) * speed, 
      0.2
    ));
  }
}

// --- ゲームフラッシュ ＆ 画面揺れ ---
function triggerBombEffect() {
  const flash = document.getElementById('bomb-flash');
  flash.classList.remove('hidden');
  flash.classList.add('flash-active');
  
  shakeAmount = 15; // 大きな揺れ

  // 画面全体の敵弾を消し、敵に大ダメージ
  enemyBullets.forEach(b => {
    b.dead = true;
    createExplosionParticles(b.x, b.y, '#fff', 3);
  });
  
  enemies.forEach(e => {
    e.damage(30); // 30ダメージ
  });

  setTimeout(() => {
    flash.classList.remove('flash-active');
    flash.classList.add('hidden');
  }, 4000);
}

function triggerDamageFlash(isShield = false) {
  const flash = document.getElementById('damage-flash');
  if (isShield) {
    flash.style.backgroundColor = 'rgba(5, 249, 226, 0.4)';
  } else {
    flash.style.backgroundColor = 'rgba(255, 0, 0, 0.4)';
    shakeAmount = 8; // 中くらいの揺れ
  }
  
  flash.classList.remove('hidden');
  flash.classList.add('damage-active');

  setTimeout(() => {
    flash.classList.remove('damage-active');
    flash.classList.add('hidden');
  }, 250);
}

// --- ストーリー一時停止 ---
function stopGameForStory(eventId) {
  gameState = STATE.STORY;
  startStory(eventId);
}

// --- スキル情報カード定義 ---
const SKILL_CARDS = {
  shot: { name: 'ローズショット', desc: '優雅な薔薇の花びらショット。発射数を増やし、拡散させます。', icon: '🌹' },
  laser: { name: 'ソーンレーザー', desc: '前方に敵を貫通し続ける、鋭い茨のレーザービームを放ちます。', icon: '🌿' },
  teaBomb: { name: 'ローズティーボム', desc: '熱い紅茶の入ったカップを投げ、爆発して熱水と破片を拡散します。', icon: '☕' },
  homing: { name: 'ホーミングローズ', desc: '敵を自動で追従する、美しく舞う薔薇の蕾を追加します。', icon: '🌹' },
  magnet: { name: '薔薇の引力', desc: '薔薇の香りで、遠くの記憶の欠片（XP）を吸い寄せます。', icon: '🧲' },
  shield: { name: '紅茶の盾', desc: '被弾を1度だけ防ぐバリアを展開します。（15秒で自動再装填）', icon: '🛡️' }
};

// レベルアップ時のカード抽選
function showUpgradeOverlay() {
  const overlay = document.getElementById('upgrade-overlay');
  const cardsList = document.getElementById('upgrade-cards-list');
  cardsList.innerHTML = '';

  // 強化可能なスキルのプール作成
  let pool = [];
  for (let key in player.skills) {
    const currentLv = player.skills[key];
    // 最大レベルは5とする
    if (currentLv < 5) {
      pool.push({ key: key, currentLv: currentLv });
    }
  }

  // もし空なら (全スキルMAX) ライフ回復やボム付与を候補に
  if (pool.length === 0) {
    pool.push({ key: 'heal', currentLv: 0, name: 'ライフ回復', desc: 'ライフを1回復します。', icon: '❤️' });
    pool.push({ key: 'bomb', currentLv: 0, name: '大掃除ボム充填', desc: 'ボムを1つ獲得します。', icon: '💣' });
  }

  // ランダムに3枚抽選
  const shuffled = pool.sort(() => 0.5 - Math.random());
  const selected = shuffled.slice(0, 3);

  selected.forEach(skill => {
    let cardInfo = SKILL_CARDS[skill.key];
    let isMeta = false;

    if (skill.key === 'heal') {
      cardInfo = { name: '優雅な休息', desc: 'ロザリーのHPを1回復させます。', icon: '❤️' };
      isMeta = true;
    } else if (skill.key === 'bomb') {
      cardInfo = { name: 'ローズボムチャージ', desc: 'ローズボムを1個追加します。', icon: '🌹' };
      isMeta = true;
    }

    const card = document.createElement('div');
    card.className = 'upgrade-card';
    
    const levelText = isMeta ? '' : ` (Lv.${skill.currentLv} → Lv.${skill.currentLv + 1})`;
    
    card.innerHTML = `
      <div class="upgrade-card-icon">${cardInfo.icon}</div>
      <div class="upgrade-card-info">
        <div class="upgrade-card-name">${cardInfo.name}${levelText}</div>
        <div class="upgrade-card-desc">${cardInfo.desc}</div>
      </div>
    `;

    let touched = false;
    card.addEventListener('touchstart', (e) => {
      touched = true;
      e.preventDefault();
      applyUpgrade(skill.key);
      overlay.classList.add('hidden');
      gameState = STATE.PLAYING;
    }, { passive: false });

    card.addEventListener('click', () => {
      if (touched) {
        touched = false;
        return;
      }
      applyUpgrade(skill.key);
      overlay.classList.add('hidden');
      gameState = STATE.PLAYING;
    });

    cardsList.appendChild(card);
  });

  overlay.classList.remove('hidden');
}

function applyUpgrade(key) {
  if (key === 'heal') {
    player.hp = Math.min(player.maxHp, player.hp + 1);
  } else if (key === 'bomb') {
    player.bombs = Math.min(player.maxBombs, player.bombs + 1);
  } else {
    player.skills[key]++;
    if (key === 'shield') {
      player.shieldActive = true;
    }
  }
  updateHud();
  saveGame(); // 自動セーブ
}

// --- HUD表示更新 ---
function updateHud() {
  document.getElementById('hud-score').textContent = String(score).padStart(8, '0');
  document.getElementById('hud-level').textContent = player.level;
  
  // XPバー
  const pct = Math.min(100, (player.xp / player.xpNeeded) * 100);
  document.getElementById('xp-bar-fill').style.width = `${pct}%`;
  document.getElementById('xp-text').textContent = `${player.xp} / ${player.xpNeeded}`;

  // ライフハート
  const heartsDiv = document.getElementById('hud-hearts');
  heartsDiv.innerHTML = '';
  for (let i = 0; i < player.maxHp; i++) {
    const heart = document.createElement('span');
    heart.className = `heart ${i >= player.hp ? 'empty' : ''}`;
    heart.textContent = '❤️';
    heartsDiv.appendChild(heart);
  }

  // ボムアイコン
  const bombsDiv = document.getElementById('hud-bombs');
  bombsDiv.innerHTML = '';
  for (let i = 0; i < player.maxBombs; i++) {
    const bomb = document.createElement('span');
    bomb.className = `bomb-icon ${i >= player.bombs ? 'empty' : ''}`;
    bomb.textContent = '🧹';
    bombsDiv.appendChild(bomb);
  }
}

// --- ストーリーテキストタイピング風表示 ---
function startStory(eventId) {
  gameState = STATE.STORY; // フェイルセーフ：状態をストーリー進行中に設定
  currentStoryList = storyScripts[eventId] || [];
  currentStoryIndex = 0;
  
  // BGM変更
  if (eventId === STORY_EVENTS.INTRO) {
    audio.startBgm('normal');
  } else if (eventId === STORY_EVENTS.BOSS_WARNING) {
    audio.startBgm('boss');
  } else if (eventId === STORY_EVENTS.BOSS_DEFEATED) {
    audio.startBgm('ending');
  }

  const overlay = document.getElementById('story-overlay');
  overlay.classList.remove('hidden');
  
  nextStoryLine();
}

function nextStoryLine() {
  // タイピング中にクリックされた場合 → 全文を即座に表示して止まる（次行には進まない）
  if (typingTimer) {
    clearInterval(typingTimer);
    typingTimer = null;
    document.getElementById('story-text').textContent = fullTextTarget;
    displayedText = fullTextTarget;
    return; // ここで止まり、次のクリックで次行へ進む
  }

  if (currentStoryIndex >= currentStoryList.length) {
    // 全ダイアログ終了、ゲームへ復帰
    document.getElementById('story-overlay').classList.add('hidden');
    
    if (audio.bgmType === 'ending') {
      // エンディングストーリーが終了したらゲームクリア・ゲームオーバー画面へ
      endGame(true);
    } else {
      gameState = STATE.PLAYING;
      saveGame(); // ウェーブ開始時の自動セーブ
    }
    return;
  }

  const currentLine = currentStoryList[currentStoryIndex];
  document.getElementById('story-speaker').textContent = currentLine.speaker;

  // お父様のセリフならピンク、ロザリーならシアン
  if (currentLine.speaker.includes('お父様') || currentLine.speaker.includes('マスター')) {
    document.getElementById('story-speaker').style.color = varColor('--neon-pink');
    document.getElementById('story-speaker').style.textShadow = `0 0 8px ${varColor('--neon-pink')}`;
  } else {
    document.getElementById('story-speaker').style.color = varColor('--neon-cyan');
    document.getElementById('story-speaker').style.textShadow = `0 0 8px ${varColor('--neon-cyan')}`;
  }

  fullTextTarget = currentLine.text;
  displayedText = "";
  let charIdx = 0;

  // タイピングアニメーション
  typingTimer = setInterval(() => {
    if (charIdx < fullTextTarget.length) {
      displayedText += fullTextTarget.charAt(charIdx);
      document.getElementById('story-text').textContent = displayedText;
      charIdx++;
    } else {
      clearInterval(typingTimer);
      typingTimer = null;
    }
  }, 35); // 35ms毎に1文字

  currentStoryIndex++;
}

// --- コア衝突判定 & かすり（Graze）判定 ---
function checkCollisions() {
  // 1. 自機 vs 敵弾
  enemyBullets.forEach(bullet => {
    if (bullet.dead) return;

    const dist = Math.hypot(bullet.x - player.x, bullet.y - player.y);

    // かすり判定
    if (dist < player.grazeRadius + bullet.radius) {
      if (!bullet.grazed) {
        bullet.grazed = true;
        player.grazeCount++;
        grazeCount++;
        score += 200; // かすりスコア
        player.gainXp(10); // かすり経験値
        createGrazeSparkle(bullet.x, bullet.y);
        audio.playGraze();
      }
    }

    // 衝突判定
    if (dist < player.hurtRadius + bullet.radius) {
      bullet.dead = true;
      player.hit();
    }
  });

  // 2. 自機 vs 敵機
  enemies.forEach(enemy => {
    if (enemy.dead) return;

    const dist = Math.hypot(enemy.x - player.x, enemy.y - player.y);
    if (dist < player.radius + enemy.radius) {
      player.hit();
    }

    // 3. 自機弾 vs 敵機
    bullets.forEach(bullet => {
      if (bullet.dead) return;

      if (bullet.type === 'laser') {
        // レーザーは矩形と円の衝突判定 (簡易的にX軸距離が近ければ貫通ヒット)
        const dx = Math.abs(bullet.x - enemy.x);
        const dy = Math.abs(bullet.y - enemy.y);
        
        // レーザーの有効高・幅範囲内
        if (dx < enemy.radius + bullet.width / 2 && 
            enemy.y > bullet.y - bullet.height / 2 && 
            enemy.y < bullet.y + bullet.height / 2) {
          
          enemy.damage(bullet.damage);
          // 多弾ヒットのパーティクル
          if (Math.random() < 0.2) {
            createExplosionParticles(enemy.x, enemy.y + (Math.random()-0.5)*10, varColor('--neon-cyan'), 2);
          }
        }
      } else {
        // 通常の円形弾丸
        const bulletDist = Math.hypot(enemy.x - bullet.x, enemy.y - bullet.y);
        if (bulletDist < enemy.radius + bullet.radius) {
          enemy.damage(bullet.damage);
          bullet.explode();
        }
      }
    });
  });
}

// --- ゲームループ管理 ---
let lastTime = 0;

function gameLoop(time) {
  if (lastTime === 0) lastTime = time;
  let dt = (time - lastTime) / 1000;
  
  // 60FPSの上限・フレームドロップ対策
  if (dt > 0.1) dt = 0.1;
  lastTime = time;

  // 画面揺れ減衰
  if (shakeAmount > 0) {
    shakeAmount -= dt * 30;
    if (shakeAmount < 0) shakeAmount = 0;
  }

  // 揺れがある場合キャンバス全体をずらす
  ctx.save();
  if (shakeAmount > 0) {
    const sx = (Math.random() - 0.5) * shakeAmount;
    const sy = (Math.random() - 0.5) * shakeAmount;
    ctx.translate(sx, sy);
  }

  // 画面消去
  ctx.fillStyle = varColor('--bg-dark');
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // 背景更新・描画
  starfield.update(dt);
  starfield.draw();

  if (gameState === STATE.PLAYING || gameState === STATE.STORY || gameState === STATE.UPGRADE || gameState === STATE.PAUSED) {
    // スポナー（敵湧きタイマー）更新
    if (gameState === STATE.PLAYING) {
      timeCount += dt;
      
      // 未処理のスポナーを実行
      activeSpawners.forEach((spawner, idx) => {
        if (timeCount >= spawner.time) {
          spawner.action();
          spawner.processed = true;
        }
      });
      // 処理済みを除外
      activeSpawners = activeSpawners.filter(s => !s.processed);
    }

    // 更新 (ゲーム進行中のみ)
    if (gameState === STATE.PLAYING) {
      player.update(dt, activeKeys);

      bullets.forEach(b => b.update(dt));
      enemyBullets.forEach(eb => eb.update(eb.grazed ? dt * 0.9 : dt)); // かすった弾は少し遅延する面白ギミック
      enemies.forEach(e => e.update(dt));
      xpItems.forEach(xp => xp.update(dt));
      particles.forEach(p => p.update(dt));

      // クリーンアップ
      bullets = bullets.filter(b => !b.dead);
      enemyBullets = enemyBullets.filter(eb => !eb.dead);
      enemies = enemies.filter(e => !e.dead);
      xpItems = xpItems.filter(xp => !xp.dead);
      particles = particles.filter(p => !p.dead);

      // コア衝突・かすり判定
      checkCollisions();
      
      // HUD同期
      updateHud();
    }

    // 描画 (一時停止/ストーリー中でも描画は継続)
    bullets.forEach(b => b.draw());
    xpItems.forEach(xp => xp.draw());
    enemies.forEach(e => e.draw());
    enemyBullets.forEach(eb => eb.draw());
    particles.forEach(p => p.draw());
    player.draw();

    // ジョイスティックの描画
    if (joystick.active) {
      drawJoystick();
    }

    // WARNING警告の表示
    if (isWarningActive) {
      drawWarningBanner();
    }

    // ボスHP表示の追跡
    const boss = enemies.find(e => e.type === 'boss');
    if (boss) {
      const bossHpPct = Math.max(0, (boss.hp / boss.maxHp) * 100);
      document.getElementById('boss-hp-fill').style.width = `${bossHpPct}%`;
    } else {
      document.getElementById('boss-hud').classList.add('hidden');
    }
  }

  ctx.restore(); // 画面揺れのリストア

  requestAnimationFrame(gameLoop);
}

function drawJoystick() {
  ctx.save();

  // 1. 外側の円（ベース）
  ctx.beginPath();
  ctx.arc(joystick.startX, joystick.startY, joystick.maxRadius, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(7, 10, 25, 0.45)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(5, 249, 226, 0.55)';
  ctx.lineWidth = 3;
  ctx.shadowColor = varColor('--neon-cyan');
  ctx.shadowBlur = 8;
  ctx.stroke();

  // 十字線ガイド
  ctx.shadowBlur = 0;
  ctx.strokeStyle = 'rgba(5, 249, 226, 0.15)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(joystick.startX - joystick.maxRadius, joystick.startY);
  ctx.lineTo(joystick.startX + joystick.maxRadius, joystick.startY);
  ctx.moveTo(joystick.startX, joystick.startY - joystick.maxRadius);
  ctx.lineTo(joystick.startX, joystick.startY + joystick.maxRadius);
  ctx.stroke();

  // 2. 内側の円（ノブ）
  ctx.beginPath();
  ctx.arc(joystick.currentX, joystick.currentY, 16, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255, 42, 133, 0.7)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 42, 133, 0.95)';
  ctx.lineWidth = 2;
  ctx.shadowColor = varColor('--neon-pink');
  ctx.shadowBlur = 10;
  ctx.stroke();

  ctx.restore();
}

function drawWarningBanner() {
  ctx.save();
  const flashAlpha = Math.abs(Math.sin(Date.now() / 150));
  ctx.fillStyle = `rgba(255, 42, 133, ${flashAlpha * 0.15})`;
  ctx.fillRect(0, HEIGHT / 2 - 50, WIDTH, 100);

  ctx.strokeStyle = `rgba(255, 42, 133, ${flashAlpha * 0.7})`;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, HEIGHT / 2 - 50);
  ctx.lineTo(WIDTH, HEIGHT / 2 - 50);
  ctx.moveTo(0, HEIGHT / 2 + 50);
  ctx.lineTo(WIDTH, HEIGHT / 2 + 50);
  ctx.stroke();

  ctx.font = `800 16px 'Outfit'`;
  ctx.fillStyle = `rgba(255, 255, 255, ${flashAlpha})`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('WARNING! CORE SYSTEM OVERLOAD', WIDTH / 2, HEIGHT / 2 - 15);
  
  ctx.font = `8px 'Press Start 2P'`;
  ctx.fillStyle = varColor('--neon-pink');
  ctx.fillText('ANOMALY DETECTED IN MEMORY STREAM', WIDTH / 2, HEIGHT / 2 + 15);
  ctx.restore();
}

// --- ゲーム開始 / 終了シーケンス ---
function startGame() {
  // 初期化
  player.reset();
  bullets = [];
  enemyBullets = [];
  enemies = [];
  xpItems = [];
  particles = [];
  score = 0;
  grazeCount = 0;
  timeCount = 0;
  
  deleteSaveData(); // 新規ゲーム開始時は古いセーブデータを消去
  
  // スポナーの複製
  activeSpawners = waveSpawners.map(s => ({ ...s, processed: false }));

  document.getElementById('menu-overlay').classList.add('hidden');
  document.getElementById('game-over-overlay').classList.add('hidden');
  document.getElementById('hud-overlay').classList.remove('hidden');
  document.getElementById('boss-hud').classList.add('hidden');

  updateHud();
  
  // イントロストーリーから開始
  stopGameForStory(STORY_EVENTS.INTRO);
}

function endGame(isClear = false) {
  gameState = STATE.GAMEOVER;
  audio.stopBgm();
  deleteSaveData(); // ゲームオーバー（またはクリア）時にセーブデータを消去

  document.getElementById('hud-overlay').classList.add('hidden');
  document.getElementById('boss-hud').classList.add('hidden');

  const overlay = document.getElementById('game-over-overlay');
  const title = document.getElementById('result-title');
  
  if (isClear) {
    title.textContent = 'MEMORY CLEANED! ✦';
    title.style.color = varColor('--neon-cyan');
    title.style.textShadow = `0 0 10px ${varColor('--neon-cyan')}`;
    audio.startBgm('ending'); // エンディングBGM
  } else {
    title.textContent = 'MEMORY DELETED...';
    title.style.color = varColor('--neon-pink');
    title.style.textShadow = `0 0 10px ${varColor('--neon-pink')}`;
  }

  // スコア表示
  document.getElementById('res-score').textContent = score;
  document.getElementById('res-level').textContent = player.level;
  document.getElementById('res-graze').textContent = grazeCount;

  // 以前登録した名前があれば初期表示
  const savedName = localStorage.getItem('apfelrose_player_name');
  if (savedName) {
    document.getElementById('player-name').value = savedName;
  } else {
    // ランダムなメイドIDを仮設定
    document.getElementById('player-name').value = `ロザリー#${Math.floor(100 + Math.random() * 900)}`;
  }

  overlay.classList.remove('hidden');
}

// --- ランキングAPI / ローカルストレージ連携 ---
function loadRanking() {
  const rankingList = document.getElementById('ranking-list');
  rankingList.innerHTML = '<tr><td colspan="4" style="text-align:center;">読込中...</td></tr>';

  fetch('/api/ranking')
    .then(res => {
      if (!res.ok) throw new Error('API error');
      return res.json();
    })
    .then(data => {
      renderRankingTable(data);
    })
    .catch(() => {
      // サーバーエラー時はLocalStorageフォールバック
      const localData = JSON.parse(localStorage.getItem('apfelrose_ranking') || '[]');
      renderRankingTable(localData);
    });
}

function renderRankingTable(data) {
  const rankingList = document.getElementById('ranking-list');
  rankingList.innerHTML = '';

  if (data.length === 0) {
    rankingList.innerHTML = '<tr><td colspan="4" style="text-align:center;">思い出データがありません。最初のメイドになりましょう！🏆</td></tr>';
    return;
  }

  data.slice(0, 10).forEach((row, index) => {
    const tr = document.createElement('tr');
    
    // 順位メダル装飾
    let rankHtml = `${index + 1}`;
    if (index === 0) rankHtml = '<span class="rank-gold">1st</span>';
    else if (index === 1) rankHtml = '<span class="rank-silver">2nd</span>';
    else if (index === 2) rankHtml = '<span class="rank-bronze">3rd</span>';

    tr.innerHTML = `
      <td>${rankHtml}</td>
      <td style="font-weight: 800;">${escapeHtml(row.name)}</td>
      <td style="color:${varColor('--neon-yellow')}">${row.score}</td>
      <td style="font-size:11px; text-align:left; color:${varColor('--text-muted')}">${escapeHtml(row.comment || '')}</td>
    `;
    rankingList.appendChild(tr);
  });
}

function submitScore() {
  const nameInput = document.getElementById('player-name');
  const commentInput = document.getElementById('player-comment');
  const name = nameInput.value.trim() || '名無しのメイド';
  const comment = commentInput.value.trim();

  // 名前を次回のためにローカル保存
  localStorage.setItem('apfelrose_player_name', name);

  const scoreData = { name, score, comment };

  // サーバーAPIへ送信
  fetch('/api/ranking', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(scoreData)
  })
  .then(res => {
    if (!res.ok) throw new Error('Save failed');
    return res.json();
  })
  .then(() => {
    showRankingScreen();
  })
  .catch(() => {
    // オフライン/ローカル保存フォールバック
    let localData = JSON.parse(localStorage.getItem('apfelrose_ranking') || '[]');

    // 重複チェック（高スコア上書き）
    const existingIdx = localData.findIndex(r => r.name === name);
    if (existingIdx !== -1) {
      if (score > localData[existingIdx].score) {
        localData[existingIdx] = { name, score, comment, created_at: new Date().toISOString() };
      }
    } else {
      localData.push({ name, score, comment, created_at: new Date().toISOString() });
    }

    localData.sort((a, b) => b.score - a.score);
    localStorage.setItem('apfelrose_ranking', JSON.stringify(localData.slice(0, 100)));
    showRankingScreen();
  });
}

function showRankingScreen() {
  document.getElementById('game-over-overlay').classList.add('hidden');
  document.getElementById('menu-overlay').classList.add('hidden');
  document.getElementById('ranking-overlay').classList.remove('hidden');
  loadRanking();
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
}

// --- イベントリスナー ＆ 入力ハンドラ ---
window.addEventListener('keydown', e => {
  activeKeys[e.code] = true;
  
  // スペースキーでボム（プレイ中のみ）
  if (e.code === 'Space') {
    if (gameState === STATE.PLAYING) {
      player.useBomb();
    } else if (gameState === STATE.STORY) {
      // ストーリー進行
      nextStoryLine();
    }
  }

  // ポーズ切り替え (Esc または P)
  if (e.code === 'Escape' || e.code === 'KeyP') {
    if (gameState === STATE.PLAYING) {
      pauseGame();
    } else if (gameState === STATE.PAUSED) {
      resumeGame();
    }
  }
});

window.addEventListener('keyup', e => {
  activeKeys[e.code] = false;
});

// マウスドラッグ操作（バーチャルジョイスティック）
canvas.addEventListener('mousedown', e => {
  if (gameState !== STATE.PLAYING) return;
  const rect = canvas.getBoundingClientRect();
  const canvasX = (e.clientX - rect.left) * (WIDTH / rect.width);
  const canvasY = (e.clientY - rect.top) * (HEIGHT / rect.height);

  joystick.active = true;
  joystick.isMouse = true;
  joystick.startX = canvasX;
  joystick.startY = canvasY;
  joystick.currentX = canvasX;
  joystick.currentY = canvasY;
  audio.init();
});

canvas.addEventListener('mousemove', e => {
  if (!joystick.active || !joystick.isMouse) return;
  const rect = canvas.getBoundingClientRect();
  const canvasX = (e.clientX - rect.left) * (WIDTH / rect.width);
  const canvasY = (e.clientY - rect.top) * (HEIGHT / rect.height);

  const dx = canvasX - joystick.startX;
  const dy = canvasY - joystick.startY;
  const dist = Math.hypot(dx, dy);

  if (dist <= joystick.maxRadius) {
    joystick.currentX = canvasX;
    joystick.currentY = canvasY;
  } else {
    joystick.currentX = joystick.startX + (dx / dist) * joystick.maxRadius;
    joystick.currentY = joystick.startY + (dy / dist) * joystick.maxRadius;
  }
});

const endMouseJoystick = () => {
  if (joystick.active && joystick.isMouse) {
    joystick.active = false;
  }
};
window.addEventListener('mouseup', endMouseJoystick);

// ストーリー送りはストーリー画面全体でタップ・クリックを受け付ける
const storyOverlay = document.getElementById('story-overlay');
storyOverlay.addEventListener('click', () => {
  if (gameState === STATE.STORY) {
    nextStoryLine();
  }
});

storyOverlay.addEventListener('touchstart', e => {
  e.preventDefault();
  if (gameState === STATE.STORY) {
    nextStoryLine();
  }
}, { passive: false });

// モバイルタッチ操作（バーチャルジョイスティック）
canvas.addEventListener('touchstart', e => {
  if (gameState !== STATE.PLAYING) return;
  e.preventDefault();
  const rect = canvas.getBoundingClientRect();
  const touch = e.touches[0];
  const canvasX = (touch.clientX - rect.left) * (WIDTH / rect.width);
  const canvasY = (touch.clientY - rect.top) * (HEIGHT / rect.height);

  joystick.active = true;
  joystick.isMouse = false;
  joystick.touchId = touch.identifier;
  joystick.startX = canvasX;
  joystick.startY = canvasY;
  joystick.currentX = canvasX;
  joystick.currentY = canvasY;
  audio.init();
}, { passive: false });

canvas.addEventListener('touchmove', e => {
  if (!joystick.active || joystick.isMouse) return;
  e.preventDefault();
  const rect = canvas.getBoundingClientRect();
  
  let touch = null;
  for (let i = 0; i < e.touches.length; i++) {
    if (e.touches[i].identifier === joystick.touchId) {
      touch = e.touches[i];
      break;
    }
  }
  if (!touch) return;

  const canvasX = (touch.clientX - rect.left) * (WIDTH / rect.width);
  const canvasY = (touch.clientY - rect.top) * (HEIGHT / rect.height);

  const dx = canvasX - joystick.startX;
  const dy = canvasY - joystick.startY;
  const dist = Math.hypot(dx, dy);

  if (dist <= joystick.maxRadius) {
    joystick.currentX = canvasX;
    joystick.currentY = canvasY;
  } else {
    joystick.currentX = joystick.startX + (dx / dist) * joystick.maxRadius;
    joystick.currentY = joystick.startY + (dy / dist) * joystick.maxRadius;
  }
}, { passive: false });

const endTouchJoystick = (e) => {
  if (!joystick.active || joystick.isMouse) return;
  let ended = false;
  for (let i = 0; i < e.changedTouches.length; i++) {
    if (e.changedTouches[i].identifier === joystick.touchId) {
      ended = true;
      break;
    }
  }
  if (ended) {
    joystick.active = false;
    joystick.touchId = null;
  }
};
canvas.addEventListener('touchend', endTouchJoystick);
canvas.addEventListener('touchcancel', endTouchJoystick);

// モバイルボムボタン
const mobileBombBtn = document.getElementById('mobile-bomb-btn');
mobileBombBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  if (gameState === STATE.PLAYING) {
    player.useBomb();
  }
});

mobileBombBtn.addEventListener('touchstart', (e) => {
  e.preventDefault();
  e.stopPropagation();
  if (gameState === STATE.PLAYING) {
    player.useBomb();
  }
}, { passive: false });

// UI タップイベント登録用ヘルパー（スマホでの無反応・二重実行防止用）
function addTapListener(id, callback) {
  const el = document.getElementById(id);
  if (!el) return;
  let touched = false;
  el.addEventListener('touchstart', (e) => {
    touched = true;
    e.preventDefault();
    callback(e);
  }, { passive: false });
  el.addEventListener('click', (e) => {
    if (touched) {
      touched = false;
      return;
    }
    callback(e);
  });
}

// UI ボタンのバインド
addTapListener('btn-start', () => {
  audio.init();
  startGame();
});

addTapListener('btn-show-ranking', () => {
  document.getElementById('menu-overlay').classList.add('hidden');
  document.getElementById('ranking-overlay').classList.remove('hidden');
  loadRanking();
});

addTapListener('btn-show-how', () => {
  document.getElementById('menu-overlay').classList.add('hidden');
  document.getElementById('how-overlay').classList.remove('hidden');
});

addTapListener('btn-close-how', () => {
  document.getElementById('how-overlay').classList.add('hidden');
  document.getElementById('menu-overlay').classList.remove('hidden');
});

addTapListener('btn-close-ranking', () => {
  document.getElementById('ranking-overlay').classList.add('hidden');
  document.getElementById('menu-overlay').classList.remove('hidden');
});

addTapListener('btn-retry', () => {
  startGame();
});

addTapListener('btn-return-menu', () => {
  document.getElementById('game-over-overlay').classList.add('hidden');
  document.getElementById('menu-overlay').classList.remove('hidden');
  audio.stopBgm();
  audio.startBgm('menu');
});

addTapListener('btn-submit-score', submitScore);

// バージョン管理情報の動的ロード
function loadVersionInfo() {
  const updateVersionDOM = (data) => {
    const versionEl = document.getElementById('footer-version');
    const dateEl = document.getElementById('footer-date');
    if (versionEl) versionEl.textContent = data.version;
    if (dateEl) dateEl.textContent = `最終更新: ${data.lastUpdated}`;
  };

  if (window.gameVersionInfo) {
    updateVersionDOM(window.gameVersionInfo);
    return;
  }

  fetch(`version.json?t=${Date.now()}`)
    .then(response => {
      if (!response.ok) throw new Error('Failed to load version.json');
      return response.json();
    })
    .then(data => {
      updateVersionDOM(data);
    })
    .catch(error => {
      console.warn('Could not load version info:', error);
    });
}

// BGM・SEトグル (スタートメニュー)
document.getElementById('menu-bgm-toggle').addEventListener('change', (e) => {
  audio.setBgmVolume(e.target.checked);
  // ポーズ画面側のトグルも同期
  const pauseBgm = document.getElementById('pause-bgm-toggle');
  if (pauseBgm) pauseBgm.checked = e.target.checked;
});
document.getElementById('menu-se-toggle').addEventListener('change', (e) => {
  audio.setSeVolume(e.target.checked);
  // ポーズ画面側のトグルも同期
  const pauseSe = document.getElementById('pause-se-toggle');
  if (pauseSe) pauseSe.checked = e.target.checked;
});

// BGM・SEトグル (ポーズ画面)
document.getElementById('pause-bgm-toggle').addEventListener('change', (e) => {
  audio.setBgmVolume(e.target.checked);
  // メニュー画面側のトグルも同期
  const menuBgm = document.getElementById('menu-bgm-toggle');
  if (menuBgm) menuBgm.checked = e.target.checked;
});
document.getElementById('pause-se-toggle').addEventListener('change', (e) => {
  audio.setSeVolume(e.target.checked);
  // メニュー画面側のトグルも同期
  const menuSe = document.getElementById('menu-se-toggle');
  if (menuSe) menuSe.checked = e.target.checked;
});

// ポーズボタンのクリックイベント
document.getElementById('btn-hud-pause').addEventListener('click', () => {
  if (gameState === STATE.PLAYING) {
    pauseGame();
  }
});

// ポーズ解除ボタンのクリックイベント
document.getElementById('btn-resume').addEventListener('click', () => {
  if (gameState === STATE.PAUSED) {
    resumeGame();
  }
});

// ポーズ制御関数
function pauseGame() {
  gameState = STATE.PAUSED;
  document.getElementById('pause-bgm-toggle').checked = audio.isBgmEnabled;
  document.getElementById('pause-se-toggle').checked = audio.isSeEnabled;
  document.getElementById('pause-overlay').classList.remove('hidden');
  saveGame(); // ポーズ時の自動セーブ
}

function resumeGame() {
  gameState = STATE.PLAYING;
  document.getElementById('pause-overlay').classList.add('hidden');
  lastTime = 0; // ポーズ解除時の経過時間(dt)跳ね上がりを防ぐ
}

// レスポンス対応スケーリング調整
// visualViewport API: スマホChromeのアドレスバー・ナビゲーションバーを除いた
// 実際の表示領域を正確に取得する
function resizeGame() {
  const wrapper = document.getElementById('game-wrapper');

  // visualViewport: スマホブラウザのUI（アドレスバー等）を除いた正確な表示領域
  // 非対応の場合は innerWidth/innerHeight にフォールバック
  const vw = (window.visualViewport ? window.visualViewport.width  : window.innerWidth);
  const vh = (window.visualViewport ? window.visualViewport.height : window.innerHeight);

  const GAME_W = 450;
  const GAME_H = 800;

  // アスペクト比を維持しながら表示領域に収まる最大スケールを計算
  const scale = Math.min(vw / GAME_W, vh / GAME_H);

  // モバイル判定: 表示幅480px未満 または スケール1未満（画面が小さい）
  const mobileMode = vw < 480 || scale < 1;
  isMobile = mobileMode;

  if (mobileMode) {
    mobileBombBtn.classList.remove('hidden');
  } else {
    mobileBombBtn.classList.add('hidden');
  }

  if (scale < 1) {
    // 画面に収まるようscaleで縮小（transform-originは中央）
    wrapper.style.width  = `${GAME_W}px`;
    wrapper.style.height = `${GAME_H}px`;
    wrapper.style.transform = `scale(${scale})`;
    wrapper.style.transformOrigin = 'center center';
    // 縮小後の実寸でbodyのflexが中央揃えできるようmarginで補正
    wrapper.style.marginTop    = `${(vh - GAME_H * scale) / 2}px`;
    wrapper.style.marginBottom = `${(vh - GAME_H * scale) / 2}px`;
  } else {
    // PC等: 固定サイズ
    wrapper.style.width  = '450px';
    wrapper.style.height = '800px';
    wrapper.style.transform = 'none';
    wrapper.style.marginTop    = '';
    wrapper.style.marginBottom = '';
  }
}

window.addEventListener('resize', resizeGame);

// visualViewport resize: スマホでスクロール・アドレスバー表示/非表示の切替時に発火
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', resizeGame);
}

resizeGame();

// --- 起動 ---
loadVersionInfo();
requestAnimationFrame(gameLoop);

// タイトル画面クリックでBGM解放 → メニューへ遷移
function initTitleScreen() {
  const titleOverlay = document.getElementById('title-overlay');
  const menuOverlay  = document.getElementById('menu-overlay');

  const onTitleClick = () => {
    titleOverlay.removeEventListener('click', onTitleClick);
    titleOverlay.removeEventListener('touchstart', onTitleClick);

    // オーディオ初期化 & メニューBGM再生
    audio.init();
    audio.startBgm('menu');

    // タイトル画面をフェードアウト
    titleOverlay.classList.add('fade-out');

    // CSSのtransitionが完了したら（0.8s後）メニューを表示
    setTimeout(() => {
      titleOverlay.classList.add('hidden');
      menuOverlay.classList.remove('hidden');
      gameState = STATE.MENU;
    }, 800);
  };

  titleOverlay.addEventListener('click', onTitleClick);
  titleOverlay.addEventListener('touchstart', onTitleClick);
}
initTitleScreen();

// --- セーブ ＆ ロード機能 ---

// ゲーム状態を保存
function saveGame() {
  const saveData = {
    score: score,
    grazeCount: grazeCount,
    waveCount: waveCount,
    timeCount: timeCount,
    player: {
      hp: player.hp,
      maxHp: player.maxHp,
      bombs: player.bombs,
      maxBombs: player.maxBombs,
      level: player.level,
      xp: player.xp,
      xpNeeded: player.xpNeeded,
      grazeCount: player.grazeCount,
      skills: { ...player.skills }
    }
  };
  localStorage.setItem('apfelrose_save_data', JSON.stringify(saveData));
  console.log('Game progress auto-saved.');
  checkSaveDataDOM();
}

// セーブデータを消去
function deleteSaveData() {
  localStorage.removeItem('apfelrose_save_data');
  console.log('Save data deleted.');
  checkSaveDataDOM();
}

// セーブデータがあるかチェックしてUI（ボタン）の状態を変更
function checkSaveDataDOM() {
  const save = localStorage.getItem('apfelrose_save_data');
  const btnContinue = document.getElementById('btn-continue');
  const btnStart = document.getElementById('btn-start');
  if (!btnContinue || !btnStart) return;

  if (save) {
    btnContinue.classList.remove('hidden');
    btnStart.classList.remove('btn-primary');
    btnStart.classList.add('btn-secondary');
  } else {
    btnContinue.classList.add('hidden');
    btnStart.classList.remove('btn-secondary');
    btnStart.classList.add('btn-primary');
  }
}

// ゲーム状態をロードして復元
function loadGame() {
  const saveJson = localStorage.getItem('apfelrose_save_data');
  if (!saveJson) return false;

  try {
    const data = JSON.parse(saveJson);

    // グローバル変数の復元
    score = data.score;
    grazeCount = data.grazeCount;
    waveCount = data.waveCount;
    timeCount = data.timeCount;

    // プレイヤープロパティの復元
    player.hp = data.player.hp;
    player.maxHp = data.player.maxHp;
    player.bombs = data.player.bombs;
    player.maxBombs = data.player.maxBombs;
    player.level = data.player.level;
    player.xp = data.player.xp;
    player.xpNeeded = data.player.xpNeeded;
    player.grazeCount = data.player.grazeCount;

    // スキルの復元
    for (let key in data.player.skills) {
      player.skills[key] = data.player.skills[key];
    }

    // オブジェクトのクリーンアップ
    enemies = [];
    bullets = [];
    enemyBullets = [];
    xpItems = [];
    particles = [];

    // スポナーの復元（現在のtimeCount以降のイベントのみ登録）
    // ただしボス出現スポナー（time:52）は後で直接処理するため除外する
    const BOSS_SPAWN_TIME = 52;
    activeSpawners = waveSpawners.map(s => ({
      ...s,
      processed: s.time <= timeCount
    })).filter(s => !s.processed);

    // HUD表示の同期
    updateHud();

    // オーバーレイの切り替え
    document.getElementById('menu-overlay').classList.add('hidden');
    document.getElementById('hud-overlay').classList.remove('hidden');

    // ボス戦中（time >= 52）でロードされた場合、ボスを即スポーンする
    if (timeCount >= BOSS_SPAWN_TIME) {
      isWarningActive = false;
      enemies.push(new Enemy(WIDTH / 2, -50, 'boss'));
      document.getElementById('boss-hud').classList.remove('hidden');
    } else {
      document.getElementById('boss-hud').classList.add('hidden');
    }

    // BGMの再開
    audio.stopBgm();
    if (timeCount >= 50) {
      audio.startBgm('boss');
    } else {
      audio.startBgm('normal');
    }

    // プレイ状態へ移行
    gameState = STATE.PLAYING;
    lastTime = 0; // dtの跳ね上がりを防ぐ

    console.log('Game progress loaded and resumed.');
    return true;
  } catch (e) {
    console.error('Failed to load save data:', e);
    return false;
  }
}

// CONTINUEボタンとSAVE & QUITボタンのタップリスナー登録
addTapListener('btn-continue', () => {
  audio.init();
  loadGame();
});

addTapListener('btn-save-quit', () => {
  saveGame();
  audio.stopBgm();
  audio.startBgm('menu'); // タイトル画面BGM
  
  // ポーズ画面とHUDを非表示にし、タイトル画面を表示
  document.getElementById('pause-overlay').classList.add('hidden');
  document.getElementById('hud-overlay').classList.add('hidden');
  document.getElementById('menu-overlay').classList.remove('hidden');
  
  gameState = STATE.MENU;
});

// 起動時にセーブデータ確認
checkSaveDataDOM();
