import Phaser from 'phaser';
import heartUrl from '../../assets/sprites/heart.png';
import redShipUrl from '../../assets/sprites/red_spaceship.png';
import whiteShipUrl from '../../assets/sprites/white_spaceship.png';
import { addEntry, getLeaderboard, qualifies } from './leaderboard.js';

const COLORS = {
	playerBullet: 0x60a5fa,
	invaderBullet: 0xef4444,
	sniperBullet: 0xfb923c,
	text: '#e4e4e7',
	rapid: 0xfbbf24,
	triple: 0x22d3ee,
	shield: 0x4ade80,
	life: 0xf472b6,
	bomb: 0xf87171
};

const ENEMY_CONFIG = {
	standard: { hp: 1, size: 54, points: 10, color: null },
	fast: { hp: 1, size: 42, points: 20, color: 0xfde047 },
	sniper: { hp: 2, size: 50, points: 30, color: 0xfb923c },
	tank: { hp: 4, size: 68, points: 40, color: 0x9ca3af },
	boss: { hp: 90, size: 170, points: 1000, color: 0xa855f7 }
};

const POWERUP_WEIGHTS = { rapid: 3, triple: 3, shield: 3, life: 1, bomb: 2 };
const POWERUP_DROP_CHANCE = 0.14;
const POWERUP_DURATION = 8000;

const SHOP_ITEMS = {
	size:     { costs: [30, 60, 100], label: 'BIGGER',    color: '#60a5fa' },
	speed:    { costs: [25, 50, 80],  label: 'SPEED',     color: '#fbbf24' },
	health:   { costs: [40, 80, 120], label: 'HEALTH',    color: '#f472b6' },
	fireRate: { costs: [35, 70, 110], label: 'FIRE RATE', color: '#22d3ee' },
	shield:   { costs: [50, 90, 140], label: 'SHIELD+',   color: '#4ade80' },
};
const COIN_REWARDS = { standard: 2, fast: 3, sniper: 4, tank: 6, boss: 25 };

const COMBO_DECAY = 2500;
const HIGH_SCORE_KEY = 'spaceInvadersHighScoreV2';

function nextLetter(letter, dir) {
	const code = letter.charCodeAt(0);
	const A = 65;
	const offset = ((code - A + dir) % 26 + 26) % 26;
	return String.fromCharCode(A + offset);
}

function weightedPick(weights) {
	const keys = Object.keys(weights);
	const total = keys.reduce((a, k) => a + weights[k], 0);
	let r = Math.random() * total;
	for (const k of keys) {
		r -= weights[k];
		if (r <= 0) return k;
	}
	return keys[keys.length - 1];
}

function createTextures(scene) {
	const rect = (key, w, h, color) => {
		const g = scene.make.graphics({ x: 0, y: 0, add: false });
		g.fillStyle(color, 1);
		g.fillRect(0, 0, w, h);
		g.generateTexture(key, w, h);
		g.destroy();
	};
	const circle = (key, r, color) => {
		const g = scene.make.graphics({ x: 0, y: 0, add: false });
		g.fillStyle(0xffffff, 1);
		g.fillCircle(r + 2, r + 2, r);
		g.fillStyle(color, 1);
		g.fillCircle(r + 2, r + 2, r - 2);
		g.generateTexture(key, (r + 2) * 2, (r + 2) * 2);
		g.destroy();
	};
	rect('playerBullet', 22, 6, COLORS.playerBullet);
	rect('invaderBullet', 18, 6, COLORS.invaderBullet);
	rect('sniperBullet', 12, 12, COLORS.sniperBullet);
	circle('pu-rapid', 10, COLORS.rapid);
	circle('pu-triple', 10, COLORS.triple);
	circle('pu-shield', 10, COLORS.shield);
	circle('pu-life', 10, COLORS.life);
	circle('pu-bomb', 10, COLORS.bomb);
}

// Minimal chiptune SFX via the WebAudio context Phaser already owns.
function playTone(scene, freq, duration, type = 'square', vol = 0.04) {
	const ctx = scene.sound?.context;
	if (!ctx || ctx.state !== 'running') return;
	const osc = ctx.createOscillator();
	const gain = ctx.createGain();
	osc.type = type;
	osc.frequency.setValueAtTime(freq, ctx.currentTime);
	gain.gain.setValueAtTime(vol, ctx.currentTime);
	gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
	osc.connect(gain).connect(ctx.destination);
	osc.start();
	osc.stop(ctx.currentTime + duration);
}

function playSweep(scene, from, to, duration, type = 'square', vol = 0.04) {
	const ctx = scene.sound?.context;
	if (!ctx || ctx.state !== 'running') return;
	const osc = ctx.createOscillator();
	const gain = ctx.createGain();
	osc.type = type;
	osc.frequency.setValueAtTime(from, ctx.currentTime);
	osc.frequency.exponentialRampToValueAtTime(Math.max(0.01, to), ctx.currentTime + duration);
	gain.gain.setValueAtTime(vol, ctx.currentTime);
	gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
	osc.connect(gain).connect(ctx.destination);
	osc.start();
	osc.stop(ctx.currentTime + duration);
}

function playNoise(scene, duration, vol = 0.05) {
	const ctx = scene.sound?.context;
	if (!ctx || ctx.state !== 'running') return;
	const bufSize = Math.max(1, Math.floor(ctx.sampleRate * duration));
	const buffer = ctx.createBuffer(1, bufSize, ctx.sampleRate);
	const data = buffer.getChannelData(0);
	for (let i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufSize);
	const src = ctx.createBufferSource();
	src.buffer = buffer;
	const gain = ctx.createGain();
	gain.gain.value = vol;
	src.connect(gain).connect(ctx.destination);
	src.start();
}

// Procedural background music: 8-step pentatonic arp + slow bass drone over
// a soft pad. Mixed through a low-pass to take the edge off. The whole loop
// is scheduled per tick — cheap, allocates nothing significant.
class GameMusic {
	constructor(ctx) {
		this.ctx = ctx;
		this.muted = false;
		/** @type {ReturnType<typeof setInterval> | null} */
		this.timer = null;
		this.step = 0;
		this.bassStep = 0;
		this.intensity = 1.0; // ramps up over time / per wave
		this.master = ctx.createGain();
		this.master.gain.value = 0.0; // fade in
		this.filter = ctx.createBiquadFilter();
		this.filter.type = 'lowpass';
		this.filter.frequency.value = 2400;
		this.filter.Q.value = 0.3;
		this.master.connect(this.filter).connect(ctx.destination);

		// A-minor pentatonic, 2 octaves of arp interleaved.
		this.arp = [220.0, 261.6, 329.6, 392.0, 523.2, 392.0, 329.6, 261.6];
		this.bass = [55.0, 55.0, 82.4, 82.4]; // A1 A1 E2 E2
	}
	start() {
		if (this.timer) return;
		// fade in
		const t = this.ctx.currentTime;
		this.master.gain.cancelScheduledValues(t);
		this.master.gain.setValueAtTime(this.master.gain.value, t);
		this.master.gain.linearRampToValueAtTime(0.35, t + 1.5);
		const stepMs = 230; // ~16th notes at ~130 bpm feel
		this.timer = setInterval(() => this.tick(stepMs), stepMs);
	}
	stop() {
		if (this.timer) clearInterval(this.timer);
		this.timer = null;
		const t = this.ctx.currentTime;
		this.master.gain.cancelScheduledValues(t);
		this.master.gain.setValueAtTime(this.master.gain.value, t);
		this.master.gain.linearRampToValueAtTime(0, t + 0.4);
	}
	toggleMute() {
		this.muted = !this.muted;
		const t = this.ctx.currentTime;
		this.master.gain.cancelScheduledValues(t);
		this.master.gain.linearRampToValueAtTime(this.muted ? 0 : 0.35, t + 0.25);
		return this.muted;
	}
	setIntensity(v) {
		this.intensity = Math.max(0.5, Math.min(2.0, v));
		this.filter.frequency.setTargetAtTime(
			1200 + this.intensity * 1400,
			this.ctx.currentTime,
			0.5
		);
	}
	tick(stepMs) {
		if (this.muted || this.ctx.state !== 'running') return;
		const t = this.ctx.currentTime;
		// Arpeggio note
		this.playNote(this.arp[this.step], stepMs / 1000 * 0.95, 'square', 0.04);
		// Soft pad fifth above every 4 steps
		if (this.step % 4 === 0) {
			this.playNote(this.arp[this.step] * 1.5, 1.6, 'sine', 0.025);
		}
		this.step = (this.step + 1) % this.arp.length;
		// Bass on each downbeat
		if (this.step % 4 === 0) {
			this.playNote(this.bass[this.bassStep], 0.45, 'triangle', 0.07);
			this.bassStep = (this.bassStep + 1) % this.bass.length;
		}
	}
	playNote(freq, dur, type, vol) {
		const ctx = this.ctx;
		const t = ctx.currentTime;
		const osc = ctx.createOscillator();
		const g = ctx.createGain();
		osc.type = type;
		osc.frequency.value = freq;
		g.gain.setValueAtTime(0.0001, t);
		g.gain.exponentialRampToValueAtTime(Math.max(0.0001, vol), t + 0.008);
		g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
		osc.connect(g).connect(this.master);
		osc.start(t);
		osc.stop(t + dur + 0.05);
	}
}

let _music = /** @type {GameMusic | null} */ (null);
function getMusic(scene) {
	const ctx = scene.sound?.context;
	if (!ctx) return null;
	if (!_music) _music = new GameMusic(ctx);
	return _music;
}

function createNebula(scene) {
	const { width, height } = scene.scale;
	const clouds = [];
	const palette = [
		[0x60a5fa, 0.06], // blue
		[0xa78bfa, 0.07], // violet
		[0x22d3ee, 0.05], // cyan
		[0xec4899, 0.04]  // magenta
	];
	for (let i = 0; i < 6; i++) {
		const [color, baseAlpha] = palette[i % palette.length];
		const r = Phaser.Math.Between(180, 360);
		const x = Phaser.Math.Between(0, width);
		const y = Phaser.Math.Between(0, height);
		const cloud = scene.add.circle(x, y, r, color, baseAlpha).setDepth(-12);
		cloud.setData('vx', Phaser.Math.FloatBetween(-4, -1));
		cloud.setData('vy', Phaser.Math.FloatBetween(-1, 1));
		clouds.push(cloud);
	}
	return clouds;
}

function createStarfield(scene) {
	const { width, height } = scene.scale;
	const layers = [
		{ count: 70, alpha: [0.08, 0.25], size: 1, speed: 8 },
		{ count: 50, alpha: [0.25, 0.55], size: 1, speed: 22 },
		{ count: 28, alpha: [0.55, 0.95], size: 2, speed: 45 }
	];
	const stars = [];
	layers.forEach((layer) => {
		for (let i = 0; i < layer.count; i++) {
			const x = Phaser.Math.Between(0, width);
			const y = Phaser.Math.Between(0, height);
			const alpha = Phaser.Math.FloatBetween(layer.alpha[0], layer.alpha[1]);
			const s = scene.add.rectangle(x, y, layer.size, layer.size, 0xffffff, alpha).setDepth(-10);
			s.setData('speed', layer.speed);
			stars.push(s);
		}
	});
	return stars;
}

class TitleScene extends Phaser.Scene {
	constructor() {
		super('title');
	}

	preload() {
		this.load.image('heart', heartUrl);
		this.load.image('player', whiteShipUrl);
		this.load.image('invader', redShipUrl);
	}

	create() {
		const { width, height } = this.scale;

		this.nebula = createNebula(this);
		this.stars = createStarfield(this);
		createTextures(this);

		// Drifting decoration ships
		this.ambient = [];
		for (let i = 0; i < 5; i++) {
			const ship = this.add.image(
				Phaser.Math.Between(0, width),
				Phaser.Math.Between(80, height - 120),
				'invader'
			);
			ship.setDisplaySize(40, 40).setAngle(-90).setAlpha(0.35).setTint(0xa855f7);
			ship.setData('vx', Phaser.Math.FloatBetween(-22, -8));
			ship.setData('vy', Phaser.Math.FloatBetween(-6, 6));
			ship.setDepth(-5);
			this.ambient.push(ship);
		}

		// Hero ship floating below title
		const hero = this.add.image(width / 2, height / 2 + 30, 'player');
		hero.setDisplaySize(96, 56).setAngle(90).setDepth(1);
		this.tweens.add({
			targets: hero,
			y: hero.y + 12,
			duration: 1800,
			yoyo: true,
			repeat: -1,
			ease: 'Sine.easeInOut'
		});
		// glow under the ship
		const glow = this.add.ellipse(hero.x, hero.y + 30, 120, 14, 0x60a5fa, 0.3).setDepth(0);
		this.tweens.add({
			targets: glow,
			scaleX: { from: 0.9, to: 1.1 },
			alpha: { from: 0.2, to: 0.45 },
			duration: 1200,
			yoyo: true,
			repeat: -1
		});

		// Big title — drawn twice for glow effect
		const titleStyle = {
			fontFamily: 'monospace',
			fontSize: '92px',
			color: '#22d3ee',
			stroke: '#0e7490',
			strokeThickness: 6
		};
		const subtitleStyle = {
			fontFamily: 'monospace',
			fontSize: '92px',
			color: '#e4e4e7',
			stroke: '#a78bfa',
			strokeThickness: 6
		};
		const titleGlow = this.add
			.text(width / 2, height / 2 - 140, 'SPACE', titleStyle)
			.setOrigin(0.5)
			.setAlpha(0.4)
			.setScale(1.06);
		const title = this.add
			.text(width / 2, height / 2 - 140, 'SPACE', titleStyle)
			.setOrigin(0.5);
		const sub = this.add
			.text(width / 2, height / 2 - 60, 'INVADERS', subtitleStyle)
			.setOrigin(0.5);
		this.tweens.add({
			targets: [titleGlow],
			alpha: { from: 0.25, to: 0.55 },
			scale: { from: 1.04, to: 1.12 },
			duration: 1400,
			yoyo: true,
			repeat: -1,
			ease: 'Sine.easeInOut'
		});
		this.tweens.add({
			targets: [title, sub],
			y: '+=4',
			duration: 1800,
			yoyo: true,
			repeat: -1,
			ease: 'Sine.easeInOut'
		});

		// Press start
		const press = this.add
			.text(width / 2, height - 180, '▶  PRESS  SPACE  OR  CLICK  TO  PLAY  ◀', {
				fontFamily: 'monospace',
				fontSize: '22px',
				color: '#fbbf24'
			})
			.setOrigin(0.5);
		this.tweens.add({
			targets: press,
			alpha: { from: 1, to: 0.25 },
			duration: 700,
			yoyo: true,
			repeat: -1
		});

		// Controls
		this.add
			.text(
				width / 2,
				height - 130,
				'↑ / ↓  MOVE      SPACE  SHOOT      D  DASH      T  TIME STOP',
				{ fontFamily: 'monospace', fontSize: '13px', color: '#9ca3af' }
			)
			.setOrigin(0.5);
		this.add
			.text(width / 2, height - 110, 'P/ESC  PAUSE      M  MUTE MUSIC      R  RESTART', {
				fontFamily: 'monospace',
				fontSize: '13px',
				color: '#6b7280'
			})
			.setOrigin(0.5);

		// Top scores panel
		this.renderTopScores();

		// Version
		this.add
			.text(width - 12, height - 12, 'v1.0', {
				fontFamily: 'monospace',
				fontSize: '11px',
				color: '#3f3f46'
			})
			.setOrigin(1, 1);

		// Input — defer music start to a real user gesture so the AudioContext
		// is in a 'running' state before we schedule notes.
		const startWithMusic = () => {
			const music = getMusic(this);
			music?.setIntensity(0.7);
			// sound.context might still need a kick on Safari
			const ctx = this.sound?.context;
			if (ctx && ctx.state === 'suspended') ctx.resume?.();
			music?.start();
			this.begin();
		};
		this.input.keyboard.once('keydown-SPACE', startWithMusic);
		this.input.keyboard.once('keydown-ENTER', startWithMusic);
		this.input.once('pointerdown', startWithMusic);
	}

	renderTopScores() {
		const { width, height } = this.scale;
		const board = getLeaderboard().slice(0, 3);
		if (board.length === 0) return;
		const panelY = height / 2 + 160;
		this.add
			.text(width / 2, panelY - 26, 'TOP SCORES', {
				fontFamily: 'monospace',
				fontSize: '14px',
				color: '#22d3ee'
			})
			.setOrigin(0.5);
		const medals = ['#fbbf24', '#d4d4d8', '#b06b3a'];
		board.forEach((e, i) => {
			this.add
				.text(
					width / 2,
					panelY + i * 22,
					`${i + 1}.  ${e.name}   ${String(e.score).padStart(6, ' ')}   W${e.wave}`,
					{
						fontFamily: 'monospace',
						fontSize: '16px',
						color: medals[i] || '#e4e4e7'
					}
				)
				.setOrigin(0.5);
		});
	}

	begin() {
		this.cameras.main.fade(400, 0, 0, 0);
		this.cameras.main.once('camerafadeoutcomplete', () => {
			this.scene.start('main');
		});
	}

	update(_time, deltaMs) {
		const { width, height } = this.scale;
		const dt = deltaMs / 1000;
		for (const s of this.stars) {
			s.x -= s.getData('speed') * dt;
			if (s.x < -2) s.x = width + 2;
		}
		for (const n of this.nebula) {
			n.x += n.getData('vx') * dt;
			n.y += n.getData('vy') * dt;
			if (n.x < -n.radius) n.x = width + n.radius;
			if (n.y < -n.radius) n.y = height + n.radius;
			if (n.y > height + n.radius) n.y = -n.radius;
		}
		for (const a of this.ambient) {
			a.x += a.getData('vx') * dt;
			a.y += a.getData('vy') * dt;
			if (a.x < -40) {
				a.x = width + 40;
				a.y = Phaser.Math.Between(80, height - 120);
			}
		}
	}
}

class MainScene extends Phaser.Scene {
	constructor() {
		super('main');
		/** @type {Phaser.GameObjects.Image[]} */
		this.hearts = [];
	}

	preload() {
		this.load.image('heart', heartUrl);
		this.load.image('player', whiteShipUrl);
		this.load.image('invader', redShipUrl);
	}

	create() {
		const { height } = this.scale;

		// Run state
		this.score = 0;
		this.lives = 3;
		this.maxLives = 5;
		this.wave = 0;
		this.combo = 0;
		this.lastHitTime = 0;
		this.highScore = this.loadHighScore();
		this.isGameOver = false;
		this.isPaused = false;
		this.invulnerable = false;
		this.isBossWave = false;
		this.coins = 0;
		this.shopIsOpen = false;
		this.upgrades = { size: 0, speed: 0, health: 0, fireRate: 0, shield: 0 };

		// Dash
		this.isDashing = false;
		this.dashCooldown = 0;
		this.DASH_DURATION = 160;
		this.DASH_COOLDOWN = 900;

		// Time stop
		this.timeStopped = false;
		this.timeStopCooldown = 0;
		this.TIME_STOP_DURATION = 3000;
		this.TIME_STOP_COOLDOWN = 8000;

		// Power-ups
		this.rapidUntil = 0;
		this.tripleUntil = 0;
		this.shield = 0;

		// Build world — nebula sits behind starfield for parallax depth.
		this.nebula = createNebula(this);
		this.stars = createStarfield(this);
		createTextures(this);

		// Cinematic state
		this.hitStopUntil = 0;
		this.hitStopActive = false;
		this.engineTrailTimer = 0;

		this.player = this.physics.add.sprite(90, height / 2, 'player');
		this.player.setDisplaySize(72, 42).setAngle(90).setCollideWorldBounds(true);

		this.shieldOrb = this.add
			.circle(this.player.x, this.player.y, 44, 0x4ade80, 0.12)
			.setStrokeStyle(2, 0x4ade80, 0.7)
			.setVisible(false)
			.setDepth(5);

		this.playerLine = 150;

		this.playerBullets = this.physics.add.group();
		this.invaderBullets = this.physics.add.group();
		this.invaders = this.physics.add.group();
		this.powerups = this.physics.add.group();

		// Movement state for the formation
		this.invaderDir = 1;
		this.invaderSpeed = 50;

		// Input
		this.cursors = this.input.keyboard.createCursorKeys();
		this.fireKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
		this.dashKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D);
		this.timeStopKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.T);
		this.lastFired = 0;

		this.setupHUD();

		// Collisions
		this.physics.add.overlap(this.playerBullets, this.invaders, this.hitInvader, undefined, this);
		this.physics.add.overlap(this.player, this.invaderBullets, this.hitPlayer, undefined, this);
		this.physics.add.overlap(this.player, this.powerups, this.collectPowerup, undefined, this);

		this.fireTimer = this.time.addEvent({
			delay: 800,
			loop: true,
			callback: this.invaderFire,
			callbackScope: this
		});
		this.bossFireTimer = null;
		this.bossTween = null;
		this.bossRadialTimer = null;

		this.scale.on('resize', this.handleResize, this);
		this.input.keyboard.on('keydown-P', () => this.togglePause());
		this.input.keyboard.on('keydown-ESC', () => this.togglePause());
		this.input.keyboard.on('keydown-M', () => {
			const muted = getMusic(this)?.toggleMute();
			this.showFloatingText(this.scale.width / 2, 60, muted ? 'MUSIC OFF' : 'MUSIC ON', '#fbbf24');
		});

		// Stop title-screen music, restart at gameplay intensity.
		const music = getMusic(this);
		music?.setIntensity(1.0);
		music?.start();

		this.cameras.main.fadeIn(400, 0, 0, 0);

		this.startNextWave();
	}

	loadHighScore() {
		try {
			return parseInt(localStorage.getItem(HIGH_SCORE_KEY) || '0', 10) || 0;
		} catch (e) {
			return 0;
		}
	}

	saveHighScore() {
		try {
			if (this.score > this.highScore) {
				this.highScore = this.score;
				localStorage.setItem(HIGH_SCORE_KEY, String(this.score));
			}
		} catch (e) {
			/* storage unavailable */
		}
	}

	setupHUD() {
		const { width, height } = this.scale;

		this.scoreText = this.add
			.text(16, 12, 'Score: 0', { fontFamily: 'monospace', fontSize: '22px', color: COLORS.text })
			.setDepth(10);
		this.waveText = this.add
			.text(16, 40, 'Wave 1', { fontFamily: 'monospace', fontSize: '16px', color: '#fbbf24' })
			.setDepth(10);
		this.highScoreText = this.add
			.text(16, 62, `Best: ${this.highScore}`, {
				fontFamily: 'monospace',
				fontSize: '14px',
				color: '#9ca3af'
			})
			.setDepth(10);

		this.coinText = this.add
			.text(16, 84, '◈  0', { fontFamily: 'monospace', fontSize: '14px', color: '#fbbf24' })
			.setDepth(10);

		this.comboText = this.add
			.text(width / 2, 16, '', { fontFamily: 'monospace', fontSize: '20px', color: '#22d3ee' })
			.setOrigin(0.5, 0)
			.setDepth(10);

		this.renderLives();

		// Ability HUD
		this.dashLabel = this.add
			.text(16, height - 36, 'DASH [D]', {
				fontFamily: 'monospace',
				fontSize: '14px',
				color: '#60a5fa'
			})
			.setDepth(10);
		this.dashBar = this.add
			.rectangle(16, height - 18, 80, 4, 0x60a5fa, 1)
			.setOrigin(0, 0)
			.setDepth(10);

		this.timeStopLabel = this.add
			.text(180, height - 36, 'TIME STOP [T]', {
				fontFamily: 'monospace',
				fontSize: '14px',
				color: '#a78bfa'
			})
			.setDepth(10);
		this.timeStopBar = this.add
			.rectangle(180, height - 18, 110, 4, 0xa78bfa, 1)
			.setOrigin(0, 0)
			.setDepth(10);

		this.powerupText = this.add
			.text(380, height - 36, '', { fontFamily: 'monospace', fontSize: '14px', color: '#fbbf24' })
			.setDepth(10);

		// Boss HP bar
		this.bossHpBg = this.add
			.rectangle(width / 2, height - 50, 400, 10, 0x3f1d6e, 0.7)
			.setOrigin(0.5)
			.setDepth(9)
			.setVisible(false);
		this.bossHpBar = this.add
			.rectangle(width / 2 - 200, height - 50, 400, 10, 0xa855f7, 1)
			.setOrigin(0, 0.5)
			.setDepth(10)
			.setVisible(false);
		this.bossLabel = this.add
			.text(width / 2, height - 68, 'BOSS', {
				fontFamily: 'monospace',
				fontSize: '14px',
				color: '#c4b5fd'
			})
			.setOrigin(0.5)
			.setDepth(10)
			.setVisible(false);
	}

	handleResize() {
		const { width, height } = this.scale;
		this.renderLives();
		this.dashLabel?.setY(height - 36);
		this.dashBar?.setY(height - 18);
		this.timeStopLabel?.setY(height - 36);
		this.timeStopBar?.setY(height - 18);
		this.powerupText?.setY(height - 36);
		this.comboText?.setX(width / 2);
		if (this.bossHpBg) {
			this.bossHpBg.setPosition(width / 2, height - 50);
			this.bossHpBar.setPosition(width / 2 - 200, height - 50);
			this.bossLabel.setPosition(width / 2, height - 68);
		}
	}

	renderLives() {
		this.hearts.forEach((h) => h.destroy());
		this.hearts = [];

		const size = 28;
		const gap = 6;
		const margin = 16;
		const { width } = this.scale;

		for (let i = 0; i < this.lives; i++) {
			const heart = this.add
				.image(width - margin - i * (size + gap), margin, 'heart')
				.setOrigin(1, 0)
				.setDisplaySize(size, size)
				.setDepth(10);
			this.hearts.push(heart);
		}
	}

	// ---------- Waves ----------

	startNextWave() {
		if (this.isGameOver) return;
		this.wave += 1;
		this.waveText.setText(`Wave ${this.wave}`);
		this.invaderSpeed = Math.min(50 + this.wave * 5, 180);
		this.fireTimer.delay = Math.max(800 - this.wave * 30, 280);

		const { width, height } = this.scale;
		const isBoss = this.wave % 5 === 0;
		this.cinematicBanner(width, height, isBoss);
		getMusic(this)?.setIntensity(1.0 + this.wave * 0.05);

		if (isBoss) this.spawnBoss(this.wave);
		else this.spawnFormation(this.wave);
	}

	cinematicBanner(width, height, isBoss) {
		const msg = isBoss ? `WAVE ${this.wave}` : `WAVE ${this.wave}`;
		const sub = isBoss ? '◆  BOSS  INCOMING  ◆' : 'INCOMING';
		const color = isBoss ? '#a855f7' : '#fbbf24';
		const stroke = isBoss ? '#581c87' : '#7c2d12';
		const cy = height / 2;

		// Twin horizontal bars sweep in, deliver text, sweep out.
		const bar1 = this.add
			.rectangle(width / 2, cy - 38, width * 1.5, 0, 0x000000, 0.6)
			.setDepth(19);
		const bar2 = this.add
			.rectangle(width / 2, cy + 38, width * 1.5, 0, 0x000000, 0.6)
			.setDepth(19);
		this.tweens.add({
			targets: [bar1, bar2],
			height: { from: 0, to: 56 },
			duration: 220,
			ease: 'Quad.easeOut'
		});

		const title = this.add
			.text(width / 2 + 600, cy - 12, msg, {
				fontFamily: 'monospace',
				fontSize: '54px',
				color,
				stroke,
				strokeThickness: 6
			})
			.setOrigin(0.5)
			.setDepth(20);
		const subText = this.add
			.text(width / 2 - 600, cy + 28, sub, {
				fontFamily: 'monospace',
				fontSize: '18px',
				color: '#e4e4e7'
			})
			.setOrigin(0.5)
			.setDepth(20);

		this.tweens.add({
			targets: title,
			x: width / 2,
			duration: 360,
			ease: 'Cubic.easeOut'
		});
		this.tweens.add({
			targets: subText,
			x: width / 2,
			duration: 360,
			ease: 'Cubic.easeOut'
		});

		this.time.delayedCall(1100, () => {
			this.tweens.add({
				targets: title,
				x: width / 2 - 800,
				alpha: 0,
				duration: 360,
				ease: 'Cubic.easeIn',
				onComplete: () => title.destroy()
			});
			this.tweens.add({
				targets: subText,
				x: width / 2 + 800,
				alpha: 0,
				duration: 360,
				ease: 'Cubic.easeIn',
				onComplete: () => subText.destroy()
			});
			this.tweens.add({
				targets: [bar1, bar2],
				height: 0,
				duration: 260,
				ease: 'Quad.easeIn',
				onComplete: () => {
					bar1.destroy();
					bar2.destroy();
				}
			});
		});

		if (isBoss) {
			this.cameras.main.flash(280, 168, 85, 247);
			playSweep(this, 110, 55, 0.9, 'sawtooth', 0.06);
		}
	}

	spawnFormation(waveNum) {
		const { width, height } = this.scale;
		const cols = Math.min(4 + Math.floor(waveNum / 3), 7);
		const rows = Math.min(3 + Math.floor(waveNum / 4), 6);
		const gapX = 72;
		const gapY = 68;
		const startX = width - 110 - (cols - 1) * gapX;
		const startY = height / 2 - ((rows - 1) * gapY) / 2;

		for (let c = 0; c < cols; c++) {
			for (let r = 0; r < rows; r++) {
				let type = 'standard';
				const roll = Math.random();
				if (waveNum >= 4 && roll < 0.18) type = 'tank';
				else if (waveNum >= 2 && roll < 0.35) type = 'sniper';
				else if (waveNum >= 1 && roll < 0.5) type = 'fast';
				this.spawnInvader(startX + c * gapX, startY + r * gapY, type);
			}
		}
		this.isBossWave = false;
	}

	spawnInvader(x, y, type) {
		const cfg = ENEMY_CONFIG[type];
		const inv = this.invaders.create(x, y, 'invader');
		inv.setDisplaySize(cfg.size, cfg.size).setAngle(-90);
		inv.setData('hp', cfg.hp);
		inv.setData('maxHp', cfg.hp);
		inv.setData('type', type);
		inv.setData('points', cfg.points);
		inv.setData('originalTint', cfg.color);
		if (cfg.color) inv.setTint(cfg.color);
		inv.body.setAllowGravity(false);
		return inv;
	}

	spawnBoss(waveNum) {
		const { width, height } = this.scale;
		const cfg = ENEMY_CONFIG.boss;
		const hp = 60 + waveNum * 12;
		const boss = this.invaders.create(width - 160, height / 2, 'invader');
		boss.setDisplaySize(cfg.size, cfg.size).setAngle(-90);
		boss.setData('hp', hp);
		boss.setData('maxHp', hp);
		boss.setData('type', 'boss');
		boss.setData('points', cfg.points + waveNum * 100);
		boss.setData('originalTint', cfg.color);
		boss.setTint(cfg.color);
		boss.body.setAllowGravity(false);

		this.bossTween = this.tweens.add({
			targets: boss,
			y: { from: 120, to: height - 120 },
			duration: 2400,
			yoyo: true,
			repeat: -1,
			ease: 'Sine.easeInOut'
		});

		this.bossHpBg.setVisible(true);
		this.bossHpBar.setVisible(true).setScale(1, 1);
		this.bossLabel.setVisible(true);
		this.isBossWave = true;

		this.bossFireTimer = this.time.addEvent({
			delay: 850,
			loop: true,
			callback: () => this.bossFire(boss),
			callbackScope: this
		});
	}

	// ---------- Firing ----------

	fireBullet(time) {
		const x = this.player.x + 38;
		const y = this.player.y;
		if (time < this.tripleUntil) {
			[-1, 0, 1].forEach((d) => {
				const b = this.playerBullets.create(x, y, 'playerBullet');
				b.body.setAllowGravity(false);
				b.setVelocity(680, d * 220);
			});
		} else {
			const b = this.playerBullets.create(x, y, 'playerBullet');
			b.body.setAllowGravity(false);
			b.setVelocityX(680);
		}
		this.spawnMuzzleFlash(x, y);
		// Subtle recoil pushback for game feel
		this.player.x = Math.max(40, this.player.x - 2);
		playSweep(this, 1100, 1700, 0.05, 'square', 0.025);
		const delay = time < this.rapidUntil ? 100 : Math.max(140, 280 - this.upgrades.fireRate * 40);
		this.lastFired = time + delay;
	}

	spawnMuzzleFlash(x, y) {
		const flash = this.add.ellipse(x, y, 36, 18, 0xfef3c7, 0.95).setDepth(6);
		this.tweens.add({
			targets: flash,
			scaleX: { from: 1.0, to: 2.2 },
			scaleY: { from: 1.0, to: 0.3 },
			alpha: { from: 1, to: 0 },
			duration: 110,
			ease: 'Quad.easeOut',
			onComplete: () => flash.destroy()
		});
		const core = this.add.circle(x, y, 6, 0x60a5fa, 0.9).setDepth(7);
		this.tweens.add({
			targets: core,
			scale: { from: 1, to: 2.5 },
			alpha: { from: 0.9, to: 0 },
			duration: 160,
			ease: 'Quad.easeOut',
			onComplete: () => core.destroy()
		});
	}

	invaderFire() {
		if (this.isGameOver || this.timeStopped || this.isPaused || this.isBossWave) return;
		const alive = this.invaders.getChildren().filter((i) => i.active);
		if (alive.length === 0) return;

		const shots = Math.min(1 + Math.floor(this.wave / 4), 3);
		for (let i = 0; i < shots; i++) {
			const shooter = Phaser.Utils.Array.GetRandom(alive);
			if (!shooter) continue;
			if (shooter.getData('type') === 'sniper') this.fireAimedBullet(shooter);
			else this.fireStraightBullet(shooter);
		}
	}

	fireStraightBullet(shooter) {
		const bullet = this.invaderBullets.create(shooter.x - 30, shooter.y, 'invaderBullet');
		bullet.body.setAllowGravity(false);
		bullet.setVelocityX(-300);
	}

	fireAimedBullet(shooter) {
		const angle = Math.atan2(this.player.y - shooter.y, this.player.x - shooter.x);
		const bullet = this.invaderBullets.create(shooter.x - 20, shooter.y, 'sniperBullet');
		bullet.body.setAllowGravity(false);
		const speed = 340;
		bullet.setVelocity(Math.cos(angle) * speed, Math.sin(angle) * speed);
	}

	bossFire(boss) {
		if (this.isGameOver || this.timeStopped || this.isPaused || !boss.active) return;
		const baseAngle = Math.atan2(this.player.y - boss.y, this.player.x - boss.x);
		const spread = 0.18;
		for (let i = -2; i <= 2; i++) {
			const angle = baseAngle + i * spread;
			const bullet = this.invaderBullets.create(boss.x - 80, boss.y, 'sniperBullet');
			bullet.body.setAllowGravity(false);
			bullet.setVelocity(Math.cos(angle) * 300, Math.sin(angle) * 300);
		}
		playNoise(this, 0.12);
	}

	// ---------- Abilities ----------

	doDash(time) {
		if (this.isDashing || time < this.dashCooldown) return;
		const dir = this.cursors.up.isDown ? -1 : this.cursors.down.isDown ? 1 : 0;
		if (dir === 0) return;
		this.executeDash(time, dir);
	}

	// Gesture-triggered dash: pick a direction from the hand target or
	// the player's current velocity so the gesture is always usable.
	doGestureDash(time) {
		if (this.isDashing || time < this.dashCooldown) return;
		const c = this.game.controls;
		let dir = 0;
		if (c?.targetY != null) {
			const target = c.targetY * this.scale.height;
			dir = target < this.player.y ? -1 : 1;
		} else {
			dir = this.player.body?.velocity.y < 0 ? -1 : 1;
		}
		this.executeDash(time, dir);
	}

	executeDash(time, dir) {
		this.isDashing = true;
		this.dashCooldown = time + this.DASH_COOLDOWN;
		this.dashLabel.setColor('#374151');

		for (let i = 0; i < 5; i++) {
			this.time.delayedCall(i * 28, () => {
				if (!this.player?.active) return;
				const ghost = this.add.image(this.player.x, this.player.y, 'player');
				ghost
					.setDisplaySize(72, 42)
					.setAngle(90)
					.setAlpha(0.5 - i * 0.08)
					.setTint(0x60a5fa);
				this.tweens.add({
					targets: ghost,
					alpha: 0,
					y: ghost.y - dir * (i * 12),
					duration: 220,
					ease: 'Quad.easeOut',
					onComplete: () => ghost.destroy()
				});
			});
		}

		this.cameras.main.shake(130, 0.007);
		this.player.setVelocityY(dir * 950);
		playSweep(this, 220, 720, 0.18, 'sawtooth', 0.05);

		this.time.delayedCall(this.DASH_DURATION, () => {
			this.isDashing = false;
		});
		this.time.delayedCall(this.DASH_COOLDOWN, () => {
			this.dashLabel.setColor('#60a5fa');
		});
	}

	doTimeStop(time) {
		if (this.timeStopped || time < this.timeStopCooldown) return;

		this.timeStopped = true;
		this.timeStopCooldown = time + this.TIME_STOP_COOLDOWN;
		this.timeStopLabel.setColor('#374151');

		// Freeze invader bullets — remember their velocity to restore.
		this.invaderBullets.getChildren().forEach((b) => {
			b.setData('frozenVx', b.body.velocity.x);
			b.setData('frozenVy', b.body.velocity.y);
			b.setVelocity(0, 0);
		});

		this.invaders.getChildren().forEach((inv) => inv.setTint(0xa78bfa));
		this.bossTween?.pause();
		this.cameras.main.flash(250, 60, 40, 160);
		playSweep(this, 1200, 200, 0.5, 'sine', 0.05);

		this.time.delayedCall(this.TIME_STOP_DURATION, () => {
			this.timeStopped = false;
			this.invaderBullets.getChildren().forEach((b) => {
				if (!b.active) return;
				const vx = b.getData('frozenVx');
				const vy = b.getData('frozenVy');
				b.setVelocity(vx ?? -300, vy ?? 0);
			});
			this.invaders.getChildren().forEach((inv) => {
				if (!inv.active) return;
				const t = inv.getData('originalTint');
				if (t) inv.setTint(t);
				else inv.clearTint();
			});
			this.bossTween?.resume();
			this.timeStopLabel.setColor('#a78bfa');
		});
	}

	// ---------- Combat resolution ----------

	// Brief world freeze on impact — single biggest game-feel improvement.
	hitStop(ms = 45) {
		this.hitStopUntil = Math.max(this.hitStopUntil, this.time.now + ms);
	}

	hitInvader(bullet, invader) {
		bullet.destroy();
		if (!invader.active) return;

		const hp = invader.getData('hp') - 1;
		invader.setData('hp', hp);

		if (hp > 0) {
			// Damage flash
			invader.setTint(0xffffff);
			this.time.delayedCall(70, () => {
				if (!invader.active) return;
				const t = invader.getData('originalTint');
				if (this.timeStopped) invader.setTint(0xa78bfa);
				else if (t) invader.setTint(t);
				else invader.clearTint();
			});
			if (invader.getData('type') === 'boss') {
				this.updateBossHpBar(invader);
				this.checkBossPhase(invader);
				this.hitStop(20);
			}
			playTone(this, 540, 0.05, 'square', 0.025);
			return;
		}

		// Kill
		const now = this.time.now;
		if (now - this.lastHitTime < COMBO_DECAY) this.combo += 1;
		else this.combo = 1;
		this.lastHitTime = now;
		const mult = Math.min(1 + (this.combo - 1) * 0.1, 5);

		const base = invader.getData('points');
		const gained = Math.round(base * mult);
		this.score += gained;
		this.scoreText.setText('Score: ' + this.score);
		this.showFloatingText(invader.x, invader.y, `+${gained}`);

		const type = invader.getData('type');
		const coinDrop = COIN_REWARDS[type] ?? 2;
		this.coins += coinDrop;
		this.coinText.setText('◈  ' + this.coins);

		const burstColor = invader.getData('originalTint') ?? 0xff6b6b;
		const burstCount = type === 'boss' ? 40 : type === 'tank' ? 18 : 10;
		this.spawnParticles(invader.x, invader.y, burstColor, burstCount);
		this.spawnShockwave(invader.x, invader.y, type === 'boss' ? 220 : type === 'tank' ? 120 : 70, burstColor);
		playNoise(this, type === 'boss' ? 0.4 : 0.1, 0.06);

		// Juice — hit-stop and a small camera kick scaled by combo.
		const stopMs = type === 'boss' ? 120 : type === 'tank' ? 60 : 35 + Math.min(this.combo, 5) * 4;
		this.hitStop(stopMs);
		const shakeAmt = type === 'boss' ? 0.014 : 0.004 + Math.min(this.combo, 5) * 0.0015;
		this.cameras.main.shake(80, shakeAmt);

		if (type === 'boss' || Math.random() < POWERUP_DROP_CHANCE) this.spawnPowerup(invader.x, invader.y);

		const wasBoss = type === 'boss';
		invader.destroy();

		if (wasBoss) {
			this.isBossWave = false;
			this.bossHpBar.setVisible(false);
			this.bossHpBg.setVisible(false);
			this.bossLabel.setVisible(false);
			this.bossFireTimer?.remove();
			this.bossFireTimer = null;
			this.bossRadialTimer?.remove();
			this.bossRadialTimer = null;
			this.bossTween?.stop();
			this.bossTween = null;
			this.cameras.main.shake(500, 0.022);
			this.cameras.main.flash(380, 200, 100, 255);
			this.hitStop(180);
			// Cinematic kill — chain of expanding rings
			for (let i = 0; i < 4; i++) {
				this.time.delayedCall(i * 120, () => {
					this.spawnShockwave(invader.x, invader.y, 240 + i * 50, [0xa855f7, 0xef4444, 0xfbbf24, 0xffffff][i]);
					this.spawnParticles(invader.x, invader.y, 0xfde047, 18);
				});
			}
			this.time.delayedCall(1800, () => this.openShopBetweenWaves());
			return;
		}

		if (this.invaders.countActive(true) === 0 && !this.isBossWave) {
			this.time.delayedCall(900, () => this.openShopBetweenWaves());
		}
	}

	updateBossHpBar(boss) {
		const pct = Math.max(0, boss.getData('hp') / boss.getData('maxHp'));
		this.bossHpBar.setScale(pct, 1);
	}

	hitPlayer(_player, bullet) {
		if (!bullet || !bullet.active || this.isGameOver) return;
		bullet.destroy();
		if (this.isDashing || this.invulnerable) return;

		if (this.shield > 0) {
			this.shield -= 1;
			this.cameras.main.flash(120, 80, 220, 120);
			playTone(this, 220, 0.1, 'sine', 0.05);
			if (this.shield === 0) this.shieldOrb.setVisible(false);
			return;
		}

		this.lives -= 1;
		this.renderLives();
		this.cameras.main.shake(200, 0.012);
		this.cameras.main.flash(120, 220, 38, 38);
		this.spawnParticles(this.player.x, this.player.y, 0xef4444, 14);
		playNoise(this, 0.25, 0.07);
		this.combo = 0;

		if (this.lives <= 0) {
			this.gameOver();
			return;
		}

		this.invulnerable = true;
		this.player.setAlpha(0.4);
		const blink = this.tweens.add({
			targets: this.player,
			alpha: { from: 0.3, to: 1 },
			duration: 120,
			yoyo: true,
			repeat: 5
		});
		this.time.delayedCall(1100, () => {
			this.invulnerable = false;
			this.player.setAlpha(1);
			blink.stop();
		});
	}

	// ---------- Power-ups ----------

	spawnPowerup(x, y) {
		const type = weightedPick(POWERUP_WEIGHTS);
		const pu = this.powerups.create(x, y, `pu-${type}`);
		pu.setData('type', type);
		pu.body.setAllowGravity(false);
		pu.setVelocityX(-120);
		pu.setVelocityY(Phaser.Math.Between(-30, 30));
		pu.setDisplaySize(22, 22);
		this.tweens.add({
			targets: pu,
			scale: { from: pu.scale * 1, to: pu.scale * 1.25 },
			yoyo: true,
			repeat: -1,
			duration: 450
		});
	}

	collectPowerup(_player, pu) {
		const type = pu.getData('type');
		pu.destroy();
		playSweep(this, 500, 1500, 0.18, 'square', 0.05);
		const colorMap = {
			rapid: '#fbbf24',
			triple: '#22d3ee',
			shield: '#4ade80',
			life: '#f472b6',
			bomb: '#f87171'
		};
		this.showFloatingText(this.player.x, this.player.y - 30, type.toUpperCase(), colorMap[type]);

		switch (type) {
			case 'rapid':
				this.rapidUntil = this.time.now + POWERUP_DURATION;
				break;
			case 'triple':
				this.tripleUntil = this.time.now + POWERUP_DURATION;
				break;
			case 'shield':
				this.shield = Math.min(this.shield + 2, 4);
				this.shieldOrb.setVisible(true);
				break;
			case 'life':
				this.lives = Math.min(this.lives + 1, this.maxLives);
				this.renderLives();
				break;
			case 'bomb':
				this.invaderBullets.getChildren().forEach((b) => {
					if (!b.active) return;
					this.spawnParticles(b.x, b.y, 0xef4444, 5);
					b.destroy();
				});
				this.cameras.main.flash(220, 255, 80, 80);
				this.cameras.main.shake(150, 0.01);
				break;
		}
	}

	// ---------- FX ----------

	showFloatingText(x, y, text, color = '#22d3ee') {
		const t = this.add
			.text(x, y, text, { fontFamily: 'monospace', fontSize: '16px', color })
			.setOrigin(0.5)
			.setDepth(15);
		this.tweens.add({
			targets: t,
			y: y - 36,
			alpha: { from: 1, to: 0 },
			duration: 720,
			ease: 'Quad.easeOut',
			onComplete: () => t.destroy()
		});
	}

	// Expanding ring — sells the impact at almost zero cost.
	spawnShockwave(x, y, maxR = 80, color = 0xffffff) {
		const ring = this.add
			.circle(x, y, 6, 0x000000, 0)
			.setStrokeStyle(3, color, 0.9)
			.setDepth(7);
		this.tweens.add({
			targets: ring,
			radius: maxR,
			alpha: { from: 0.9, to: 0 },
			duration: 380,
			ease: 'Quad.easeOut',
			onUpdate: () => ring.setRadius(ring.radius),
			onComplete: () => ring.destroy()
		});
	}

	// Cheap engine trail — small fading rectangles behind the player.
	emitEngineTrail(time) {
		if (time < this.engineTrailTimer) return;
		this.engineTrailTimer = time + 32;
		const x = this.player.x - 28;
		const y = this.player.y;
		const trail = this.add
			.rectangle(x, y, 14, 4, 0x60a5fa, 0.85)
			.setDepth(2);
		this.tweens.add({
			targets: trail,
			scaleX: { from: 1, to: 2.5 },
			alpha: { from: 0.85, to: 0 },
			x: x - 30,
			duration: 280,
			ease: 'Quad.easeOut',
			onComplete: () => trail.destroy()
		});
		// hot core
		const core = this.add.circle(x, y, 3, 0xfde047, 0.9).setDepth(3);
		this.tweens.add({
			targets: core,
			scale: { from: 1, to: 0 },
			alpha: { from: 0.9, to: 0 },
			x: x - 14,
			duration: 200,
			onComplete: () => core.destroy()
		});
	}

	// Boss enrages at 50% HP — faster fire, brighter tint, periodic radial burst.
	checkBossPhase(boss) {
		if (boss.getData('phase2')) return;
		const pct = boss.getData('hp') / boss.getData('maxHp');
		if (pct > 0.5) return;
		boss.setData('phase2', true);
		boss.setData('originalTint', 0xef4444);
		boss.setTint(0xef4444);
		this.bossHpBar.fillColor = 0xef4444;
		this.cameras.main.flash(220, 220, 40, 40);
		this.cameras.main.shake(220, 0.012);
		const warn = this.add
			.text(this.scale.width / 2, this.scale.height / 2 - 100, 'BOSS ENRAGED', {
				fontFamily: 'monospace',
				fontSize: '36px',
				color: '#ef4444',
				stroke: '#7f1d1d',
				strokeThickness: 4
			})
			.setOrigin(0.5)
			.setDepth(25);
		this.tweens.add({
			targets: warn,
			alpha: { from: 1, to: 0 },
			scale: { from: 0.8, to: 1.4 },
			duration: 1200,
			ease: 'Quad.easeOut',
			onComplete: () => warn.destroy()
		});
		if (this.bossFireTimer) this.bossFireTimer.delay = 480;
		// Radial spray every 1.4s during phase 2
		this.bossRadialTimer = this.time.addEvent({
			delay: 1400,
			loop: true,
			callback: () => {
				if (!boss.active || this.isGameOver || this.timeStopped || this.isPaused) return;
				for (let i = 0; i < 14; i++) {
					const ang = (i / 14) * Math.PI * 2;
					const b = this.invaderBullets.create(boss.x, boss.y, 'sniperBullet');
					b.body.setAllowGravity(false);
					b.setVelocity(Math.cos(ang) * 220, Math.sin(ang) * 220);
				}
				playNoise(this, 0.18, 0.05);
			}
		});
	}

	spawnParticles(x, y, color = 0xffffff, count = 12) {
		for (let i = 0; i < count; i++) {
			const p = this.add.rectangle(x, y, 4, 4, color).setDepth(8);
			const angle = Math.random() * Math.PI * 2;
			const speed = Phaser.Math.Between(60, 280);
			const dx = Math.cos(angle) * speed * 0.45;
			const dy = Math.sin(angle) * speed * 0.45;
			this.tweens.add({
				targets: p,
				x: x + dx,
				y: y + dy,
				alpha: { from: 1, to: 0 },
				duration: Phaser.Math.Between(380, 620),
				ease: 'Quad.easeOut',
				onComplete: () => p.destroy()
			});
		}
	}

	// ---------- End / pause ----------

	endText(message, color) {
		const { width, height } = this.scale;
		this.endLayer = this.add.container(0, 0).setDepth(20);

		const title = this.add
			.text(width / 2, height / 2 - 220, message, {
				fontFamily: 'monospace',
				fontSize: '60px',
				color
			})
			.setOrigin(0.5);
		const scoreText = this.add
			.text(width / 2, height / 2 - 160, `Score: ${this.score}   Wave: ${this.wave}`, {
				fontFamily: 'monospace',
				fontSize: '22px',
				color: COLORS.text
			})
			.setOrigin(0.5);
		this.endLayer.add([title, scoreText]);

		const qualifiesForBoard = qualifies(this.score);

		if (qualifiesForBoard) {
			this.showInitialEntry(width, height);
		} else {
			this.renderLeaderboardPanel(width, height, null);
			this.addRestartHint(width, height);
		}
	}

	addRestartHint(width, height) {
		const hint = this.add
			.text(width / 2, height / 2 + 240, 'Press R to play again', {
				fontFamily: 'monospace',
				fontSize: '18px',
				color: '#9ca3af'
			})
			.setOrigin(0.5);
		this.endLayer.add(hint);
		this.input.keyboard.once('keydown-R', () => this.scene.restart());
	}

	// Arcade-style three-letter initial entry. Left/Right or A-Z to set, Enter to submit.
	showInitialEntry(width, height) {
		const prompt = this.add
			.text(width / 2, height / 2 - 110, 'NEW HIGH SCORE  —  ENTER INITIALS', {
				fontFamily: 'monospace',
				fontSize: '18px',
				color: '#fbbf24'
			})
			.setOrigin(0.5);
		this.endLayer.add(prompt);

		const initials = ['A', 'A', 'A'];
		let cursor = 0;

		const slotX = [width / 2 - 50, width / 2, width / 2 + 50];
		const slots = slotX.map((x, i) =>
			this.add
				.text(x, height / 2 - 60, initials[i], {
					fontFamily: 'monospace',
					fontSize: '52px',
					color: '#e4e4e7'
				})
				.setOrigin(0.5)
		);
		const caret = this.add
			.rectangle(slotX[0], height / 2 - 25, 36, 4, 0x22d3ee)
			.setOrigin(0.5);
		this.tweens.add({
			targets: caret,
			alpha: { from: 1, to: 0.15 },
			duration: 450,
			yoyo: true,
			repeat: -1
		});

		const hint = this.add
			.text(
				width / 2,
				height / 2 - 5,
				'A-Z type   ←/→ move   ↑/↓ change   Enter submit',
				{
					fontFamily: 'monospace',
					fontSize: '13px',
					color: '#6b7280'
				}
			)
			.setOrigin(0.5);
		this.endLayer.add([...slots, caret, hint]);

		const updateView = () => {
			slots.forEach((s, i) => s.setText(initials[i]));
			caret.x = slotX[cursor];
			slots.forEach((s, i) =>
				s.setColor(i === cursor ? '#22d3ee' : '#e4e4e7')
			);
		};
		updateView();

		const letterHandler = (ev) => {
			const k = ev.key;
			if (k === 'Enter') {
				submit();
				return;
			}
			if (k === 'ArrowLeft') {
				cursor = (cursor + 2) % 3;
				updateView();
				return;
			}
			if (k === 'ArrowRight' || k === 'Tab') {
				ev.preventDefault?.();
				cursor = (cursor + 1) % 3;
				updateView();
				return;
			}
			if (k === 'ArrowUp') {
				initials[cursor] = nextLetter(initials[cursor], 1);
				updateView();
				return;
			}
			if (k === 'ArrowDown') {
				initials[cursor] = nextLetter(initials[cursor], -1);
				updateView();
				return;
			}
			if (k === 'Backspace') {
				initials[cursor] = 'A';
				cursor = Math.max(0, cursor - 1);
				updateView();
				return;
			}
			if (/^[a-zA-Z]$/.test(k)) {
				initials[cursor] = k.toUpperCase();
				if (cursor < 2) cursor += 1;
				else submit();
				updateView();
			}
		};
		this.input.keyboard.on('keydown', letterHandler);

		const submit = () => {
			this.input.keyboard.off('keydown', letterHandler);
			caret.destroy();
			const entry = {
				name: initials.join(''),
				score: this.score,
				wave: this.wave,
				date: Date.now()
			};
			addEntry(entry);
			this.renderLeaderboardPanel(this.scale.width, this.scale.height, entry);
			this.addRestartHint(this.scale.width, this.scale.height);
		};
	}

	renderLeaderboardPanel(width, height, highlight) {
		const board = getLeaderboard();
		const panelW = 460;
		const panelH = 280;
		const x = width / 2;
		const y = height / 2 + 70;

		const bg = this.add
			.rectangle(x, y, panelW, panelH, 0x0b0b13, 0.85)
			.setStrokeStyle(1, 0x22d3ee, 0.5)
			.setOrigin(0.5);
		const title = this.add
			.text(x, y - panelH / 2 + 22, 'LEADERBOARD', {
				fontFamily: 'monospace',
				fontSize: '16px',
				color: '#22d3ee'
			})
			.setOrigin(0.5);
		const header = this.add
			.text(x - panelW / 2 + 18, y - panelH / 2 + 48, '#   NAME   SCORE     WAVE', {
				fontFamily: 'monospace',
				fontSize: '13px',
				color: '#6b7280'
			})
			.setOrigin(0, 0.5);
		this.endLayer.add([bg, title, header]);

		if (board.length === 0) {
			const empty = this.add
				.text(x, y, 'No entries yet — be the first.', {
					fontFamily: 'monospace',
					fontSize: '14px',
					color: '#6b7280'
				})
				.setOrigin(0.5);
			this.endLayer.add(empty);
			return;
		}

		const rowH = 20;
		const startY = y - panelH / 2 + 76;
		board.forEach((e, i) => {
			const isMe =
				highlight &&
				e.name === highlight.name &&
				e.score === highlight.score &&
				e.date === highlight.date;
			const color = isMe ? '#fbbf24' : i === 0 ? '#22d3ee' : '#e4e4e7';
			const rank = String(i + 1).padStart(2, ' ');
			const name = e.name.padEnd(4, ' ');
			const score = String(e.score).padStart(7, ' ');
			const wave = String(e.wave).padStart(4, ' ');
			const row = this.add
				.text(
					x - panelW / 2 + 18,
					startY + i * rowH,
					`${rank}  ${name}  ${score}     ${wave}`,
					{ fontFamily: 'monospace', fontSize: '14px', color }
				)
				.setOrigin(0, 0.5);
			this.endLayer.add(row);
			if (isMe) {
				const star = this.add
					.text(x + panelW / 2 - 24, startY + i * rowH, '★', {
						fontFamily: 'monospace',
						fontSize: '14px',
						color: '#fbbf24'
					})
					.setOrigin(0.5);
				this.endLayer.add(star);
			}
		});
	}

	gameOver() {
		if (this.isGameOver) return;
		this.isGameOver = true;
		if (this.shopIsOpen) {
			this.shopIsOpen = false;
			this.game.controls.shopCallback = null;
			this.game.events.emit('shop:close');
		}
		this.saveHighScore();
		this.fireTimer.remove();
		this.bossFireTimer?.remove();
		this.bossRadialTimer?.remove();
		this.bossTween?.stop();

		// Cinematic death — chained explosions, camera zoom-in, slow-mo, then
		// fade music and reveal the end screen.
		const px = this.player.x;
		const py = this.player.y;
		this.spawnParticles(px, py, 0xfde047, 22);
		this.spawnShockwave(px, py, 140, 0xfbbf24);
		this.cameras.main.shake(400, 0.018);
		this.cameras.main.flash(220, 255, 240, 200);
		playNoise(this, 0.35, 0.08);

		// Freeze the world and zoom on the player for ~600ms before settling.
		this.physics.world.pause();
		this.cameras.main.zoomTo(1.35, 550, 'Sine.easeOut');
		this.cameras.main.pan(px, py, 550, 'Sine.easeOut');

		for (let i = 0; i < 5; i++) {
			this.time.delayedCall(120 + i * 90, () => {
				this.spawnParticles(
					px + Phaser.Math.Between(-30, 30),
					py + Phaser.Math.Between(-20, 20),
					Phaser.Utils.Array.GetRandom([0xfde047, 0xef4444, 0xfbbf24, 0xffffff]),
					12
				);
				this.spawnShockwave(px, py, 100 + i * 40, 0xfbbf24);
				this.cameras.main.shake(80, 0.008);
			});
		}

		// Make the wrecked ship blink out
		this.player.setTint(0xff6b6b);
		this.tweens.add({
			targets: this.player,
			alpha: { from: 1, to: 0 },
			scale: { from: 1, to: 0.5 },
			angle: '+=45',
			duration: 800,
			ease: 'Quad.easeIn'
		});

		// Fade music
		getMusic(this)?.stop();

		this.time.delayedCall(1100, () => {
			this.cameras.main.zoomTo(1, 350, 'Sine.easeInOut');
			const { width, height } = this.scale;
			this.cameras.main.pan(width / 2, height / 2, 350, 'Sine.easeInOut');
			this.physics.pause();
			this.endText('GAME OVER', '#ef4444');
		});
	}

	// ---------- Shop ----------

	openShopBetweenWaves() {
		if (this.isGameOver) return;
		this.shopIsOpen = true;
		this.game.controls.shopCallback = {
			buy: (type) => this.buyUpgrade(type),
			close: () => this.closeShop(),
		};
		this.game.events.emit('shop:open', {
			coins: this.coins,
			upgrades: { ...this.upgrades },
			items: SHOP_ITEMS,
		});
	}

	closeShop() {
		if (!this.shopIsOpen) return;
		this.shopIsOpen = false;
		this.game.controls.shopCallback = null;
		this.game.events.emit('shop:close');
		this.startNextWave();
	}

	buyUpgrade(type) {
		const item = SHOP_ITEMS[type];
		if (!item) return;
		const level = this.upgrades[type];
		if (level >= item.costs.length) return;
		const cost = item.costs[level];
		if (this.coins < cost) return;
		this.coins -= cost;
		this.upgrades[type] += 1;
		this.coinText.setText('◈  ' + this.coins);
		this.applyUpgrade(type);
		this.game.events.emit('shop:update', {
			coins: this.coins,
			upgrades: { ...this.upgrades },
		});
	}

	applyUpgrade(type) {
		const level = this.upgrades[type];
		switch (type) {
			case 'size': {
				const w = 72 + level * 12;
				const h = 42 + level * 7;
				this.player.setDisplaySize(w, h);
				this.shieldOrb.setRadius(44 + level * 8);
				break;
			}
			case 'health': {
				this.maxLives = Math.min(this.maxLives + 1, 8);
				this.lives = Math.min(this.lives + 1, this.maxLives);
				this.renderLives();
				break;
			}
			default: break; // speed / fireRate / shield read dynamically in update/fireBullet
		}
	}

	togglePause() {
		if (this.isGameOver) return;
		this.isPaused = !this.isPaused;
		if (this.isPaused) {
			this.physics.pause();
			this.fireTimer.paused = true;
			if (this.bossFireTimer) this.bossFireTimer.paused = true;
			this.tweens.pauseAll();
			const { width, height } = this.scale;
			this.pauseText = this.add
				.text(width / 2, height / 2, 'PAUSED', {
					fontFamily: 'monospace',
					fontSize: '60px',
					color: '#fbbf24'
				})
				.setOrigin(0.5)
				.setDepth(30);
			this.pauseHint = this.add
				.text(width / 2, height / 2 + 56, 'Press P or Esc to resume', {
					fontFamily: 'monospace',
					fontSize: '16px',
					color: '#9ca3af'
				})
				.setOrigin(0.5)
				.setDepth(30);
		} else {
			this.physics.resume();
			this.fireTimer.paused = false;
			if (this.bossFireTimer) this.bossFireTimer.paused = false;
			this.tweens.resumeAll();
			this.pauseText?.destroy();
			this.pauseHint?.destroy();
		}
	}

	// ---------- Update loop ----------

	update(time) {
		if (this.isGameOver || this.isPaused) return;

		const { width, height } = this.scale;
		const delta = this.game.loop.delta / 1000;

		// Hit-stop — pause world physics very briefly on big impacts.
		const inHitStop = time < this.hitStopUntil;
		if (inHitStop && !this.hitStopActive) {
			this.physics.pause();
			this.hitStopActive = true;
		} else if (!inHitStop && this.hitStopActive) {
			this.physics.resume();
			this.hitStopActive = false;
		}

		// Nebula drift
		for (const n of this.nebula) {
			n.x += n.getData('vx') * delta;
			n.y += n.getData('vy') * delta;
			if (n.x < -n.radius) n.x = width + n.radius;
			if (n.y < -n.radius) n.y = height + n.radius;
			else if (n.y > height + n.radius) n.y = -n.radius;
		}

		// Engine trail
		this.emitEngineTrail(time);

		// Parallax starfield
		for (const s of this.stars) {
			s.x -= s.getData('speed') * delta;
			if (s.x < -2) s.x = width + 2;
		}

		const ctrl = this.game.controls;

		// Abilities — keyboard + gesture-driven one-shots
		if (Phaser.Input.Keyboard.JustDown(this.dashKey)) this.doDash(time);
		if (Phaser.Input.Keyboard.JustDown(this.timeStopKey)) this.doTimeStop(time);
		if (ctrl?.dash) {
			ctrl.dash = false;
			this.doGestureDash(time);
		}
		if (ctrl?.timeStop) {
			ctrl.timeStop = false;
			this.doTimeStop(time);
		}

		// Player vertical movement — gesture target overrides keyboard when present.
		if (!this.isDashing) {
			if (ctrl?.targetY != null) {
				const targetY = Phaser.Math.Clamp(ctrl.targetY, 0.04, 0.96) * height;
				const dy = targetY - this.player.y;
				const vy = Phaser.Math.Clamp(dy * 11, -(520 + this.upgrades.speed * 50), 520 + this.upgrades.speed * 50);
				this.player.setVelocityY(vy);
			} else {
				const speed = 360 + this.upgrades.speed * 60;
				if (this.cursors.up.isDown) this.player.setVelocityY(-speed);
				else if (this.cursors.down.isDown) this.player.setVelocityY(speed);
				else this.player.setVelocityY(0);
			}
		}

		// Firing — held keyboard fire or pinched gesture
		const wantsFire = this.fireKey.isDown || ctrl?.shoot === true;
		if (wantsFire && time > this.lastFired) this.fireBullet(time);

		// Formation movement (skip boss & time stop)
		if (!this.timeStopped && !this.isBossWave) {
			let hitEdge = false;
			const margin = 30;
			this.invaders.getChildren().forEach((inv) => {
				if (!inv.active) return;
				let speed = this.invaderSpeed;
				if (inv.getData('type') === 'fast') speed *= 1.7;
				else if (inv.getData('type') === 'tank') speed *= 0.7;
				inv.y += this.invaderDir * speed * delta;
				if (inv.y > height - margin || inv.y < margin + 40) hitEdge = true;
			});

			if (hitEdge) {
				this.invaderDir *= -1;
				this.invaders.getChildren().forEach((inv) => {
					inv.x -= 30;
					if (inv.x < this.playerLine) this.gameOver();
				});
			}
		}

		// Combo decay
		if (this.combo > 0 && time - this.lastHitTime > COMBO_DECAY) this.combo = 0;
		if (this.combo > 1) {
			const mult = Math.min(1 + (this.combo - 1) * 0.1, 5);
			const timeLeft = Math.max(0, COMBO_DECAY - (time - this.lastHitTime));
			this.comboText.setText(`COMBO x${mult.toFixed(1)}  (${this.combo})`);
			this.comboText.setAlpha(0.45 + (timeLeft / COMBO_DECAY) * 0.55);
		} else {
			this.comboText.setText('');
		}

		// Cooldown bars
		const dashRem = Math.max(0, this.dashCooldown - time) / this.DASH_COOLDOWN;
		this.dashBar.setScale(1 - dashRem, 1);
		const tsRem = Math.max(0, this.timeStopCooldown - time) / this.TIME_STOP_COOLDOWN;
		this.timeStopBar.setScale(1 - tsRem, 1);

		// Shield orb follows player
		this.shieldOrb.x = this.player.x;
		this.shieldOrb.y = this.player.y;
		this.shieldOrb.setVisible(this.shield > 0);
		this.shieldOrb.setScale(0.9 + Math.sin(time * 0.006) * 0.05);

		// Powerup HUD
		const lines = [];
		if (time < this.rapidUntil)
			lines.push(`RAPID ${Math.ceil((this.rapidUntil - time) / 1000)}s`);
		if (time < this.tripleUntil)
			lines.push(`TRIPLE ${Math.ceil((this.tripleUntil - time) / 1000)}s`);
		if (this.shield > 0) lines.push(`SHIELD x${this.shield}`);
		this.powerupText.setText(lines.join('   '));

		// Cleanup off-screen objects
		this.cleanupOffscreen(this.playerBullets);
		this.cleanupOffscreen(this.invaderBullets);
		this.cleanupOffscreen(this.powerups);
	}

	cleanupOffscreen(group) {
		const { width, height } = this.scale;
		group.getChildren().forEach((b) => {
			if (!b.active) return;
			if (b.x < -30 || b.x > width + 30 || b.y < -30 || b.y > height + 30) b.destroy();
		});
	}
}

export function startGame(parent) {
	const config = {
		type: Phaser.AUTO,
		parent,
		backgroundColor: 0x000000,
		scale: {
			mode: Phaser.Scale.RESIZE,
			width: '100%',
			height: '100%'
		},
		physics: {
			default: 'arcade',
			arcade: { gravity: { y: 0 }, debug: false }
		},
		scene: [TitleScene, MainScene]
	};

	const game = new Phaser.Game(config);
	// External control surface. Anything (hand tracker, gamepad, mouse) can
	// drive the game by mutating this object; keyboard still works alongside.
	game.controls = {
		targetY: null, // 0..1 normalised vertical position; null = keyboard mode
		shoot: false,  // continuous
		dash: false,   // one-shot; scene consumes & resets
		timeStop: false, // one-shot
		shopCallback: null, // set by scene when shop is open
	};
	return game;
}
