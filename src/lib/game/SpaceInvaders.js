import Phaser from 'phaser';
import heartUrl from '../../assets/sprites/heart.png';
import redShipUrl from '../../assets/sprites/red_spaceship.png';
import whiteShipUrl from '../../assets/sprites/white_spaceship.png';

const COLORS = {
	playerBullet: 0x60a5fa,
	invaderBullet: 0xef4444,
	text: '#e4e4e7'
};

function createBulletTextures(scene) {
	const make = (key, w, h, color) => {
		const g = scene.make.graphics({ x: 0, y: 0, add: false });
		g.fillStyle(color, 1);
		g.fillRect(0, 0, w, h);
		g.generateTexture(key, w, h);
		g.destroy();
	};
	make('playerBullet', 22, 6, COLORS.playerBullet);
	make('invaderBullet', 18, 6, COLORS.invaderBullet);
}

function createStarfield(scene) {
	const { width, height } = scene.scale;
	const g = scene.add.graphics();
	for (let i = 0; i < 140; i++) {
		const x = Phaser.Math.Between(0, width);
		const y = Phaser.Math.Between(0, height);
		const size = Math.random() < 0.15 ? 2 : 1;
		const alpha = Phaser.Math.FloatBetween(0.15, 0.75);
		g.fillStyle(0xffffff, alpha);
		g.fillRect(x, y, size, size);
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

		this.score = 0;
		this.lives = 3;
		this.isGameOver = false;

		// Dash state
		this.isDashing = false;
		this.dashCooldown = 0;
		this.DASH_DURATION = 160;
		this.DASH_COOLDOWN = 900;

		// Time stop state
		this.timeStopped = false;
		this.timeStopCooldown = 0;
		this.TIME_STOP_DURATION = 3000;
		this.TIME_STOP_COOLDOWN = 8000;

		createStarfield(this);
		createBulletTextures(this);

		this.player = this.physics.add.sprite(90, height / 2, 'player');
		this.player.setDisplaySize(72, 42).setAngle(90).setCollideWorldBounds(true);

		this.playerLine = 150;

		this.playerBullets = this.physics.add.group();
		this.invaderBullets = this.physics.add.group();
		this.invaders = this.physics.add.group();

		this.spawnInvaders();

		this.invaderDir = 1;
		this.invaderSpeed = 50;

		// Input
		this.cursors = this.input.keyboard.createCursorKeys();
		this.fireKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
		this.dashKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D);
		this.timeStopKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.T);
		this.lastFired = 0;

		// HUD
		this.scoreText = this.add.text(16, 12, 'Score: 0', {
			fontFamily: 'monospace',
			fontSize: '22px',
			color: COLORS.text
		});
		this.renderLives();

		// Ability HUD
		this.dashLabel = this.add
			.text(16, height - 36, 'DASH [D]', { fontFamily: 'monospace', fontSize: '14px', color: '#60a5fa' })
			.setDepth(10);
		this.timeStopLabel = this.add
			.text(170, height - 36, 'TIME STOP [T]', { fontFamily: 'monospace', fontSize: '14px', color: '#a78bfa' })
			.setDepth(10);

		// Collisions
		this.physics.add.overlap(this.playerBullets, this.invaders, this.hitInvader, undefined, this);
		this.physics.add.overlap(this.invaderBullets, this.player, this.hitPlayer, undefined, this);

		this.fireTimer = this.time.addEvent({
			delay: 800,
			loop: true,
			callback: this.invaderFire,
			callbackScope: this
		});

		this.scale.on('resize', this.handleResize, this);
	}

	handleResize() {
		this.renderLives();
	}

	// Draw one heart icon per remaining life, anchored to the top-right.
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
				.setDisplaySize(size, size);
			this.hearts.push(heart);
		}
		const { height } = this.scale;
		this.dashLabel?.setY(height - 36);
		this.timeStopLabel?.setY(height - 36);
	}

	spawnInvaders() {
		const { width, height } = this.scale;
		const rows = 5;
		const cols = 6;
		const gapX = 72;
		const gapY = 70;
		const startX = width - 110 - (cols - 1) * gapX;
		const startY = height / 2 - ((rows - 1) * gapY) / 2;

		for (let c = 0; c < cols; c++) {
			for (let r = 0; r < rows; r++) {
				const inv = this.invaders.create(startX + c * gapX, startY + r * gapY, 'invader');
				inv.setDisplaySize(54, 54).setAngle(-90);
				inv.setData('points', (cols - c) * 10);
			}
		}
	}

	fireBullet() {
		const bullet = this.playerBullets.create(this.player.x + 38, this.player.y, 'playerBullet');
		bullet.setVelocityX(680);
		bullet.body.setAllowGravity(false);
	}

	invaderFire() {
		if (this.isGameOver || this.timeStopped) return;
		const alive = this.invaders.getChildren().filter((i) => i.active);
		if (alive.length === 0) return;
		const shooter = Phaser.Utils.Array.GetRandom(alive);
		const bullet = this.invaderBullets.create(shooter.x - 30, shooter.y, 'invaderBullet');
		bullet.setVelocityX(-300);
		bullet.body.setAllowGravity(false);
	}

	doDash(time) {
		if (this.isDashing || time < this.dashCooldown) return;
		const dir = this.cursors.up.isDown ? -1 : this.cursors.down.isDown ? 1 : 0;
		if (dir === 0) return;

		this.isDashing = true;
		this.dashCooldown = time + this.DASH_COOLDOWN;
		this.dashLabel.setColor('#374151');

		// Afterimage ghosts trail behind the player
		for (let i = 0; i < 5; i++) {
			this.time.delayedCall(i * 28, () => {
				if (!this.player?.active) return;
				const ghost = this.add.image(this.player.x, this.player.y, 'player');
				ghost.setDisplaySize(72, 42).setAngle(90).setAlpha(0.5 - i * 0.08).setTint(0x60a5fa);
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

		// Freeze invader bullets in place
		this.invaderBullets.getChildren().forEach((b) => b.setVelocityX(0));

		// Tint enemies violet to show they're frozen
		this.invaders.getChildren().forEach((inv) => inv.setTint(0xa78bfa));

		// Cold blue screen flash
		this.cameras.main.flash(250, 60, 40, 160);

		this.time.delayedCall(this.TIME_STOP_DURATION, () => {
			this.timeStopped = false;
			this.invaderBullets.getChildren().forEach((b) => b.setVelocityX(-300));
			this.invaders.getChildren().forEach((inv) => inv.clearTint());
			this.timeStopLabel.setColor('#a78bfa');
		});
	}

	hitInvader(bullet, invader) {
		bullet.destroy();
		this.score += invader.getData('points');
		this.scoreText.setText('Score: ' + this.score);
		invader.destroy();

		if (this.invaders.countActive(true) === 0) {
			this.win();
		}
	}

	hitPlayer(bullet, player) {
		if (this.isDashing) return; // invincible during dash
		bullet.destroy();
		this.lives -= 1;
		this.renderLives();
		this.cameras.main.shake(200, 0.014);
		this.cameras.main.flash(120, 220, 38, 38);
		if (this.lives <= 0) {
			this.gameOver();
		}
	}

	endText(message, color) {
		const { width, height } = this.scale;
		this.add
			.text(width / 2, height / 2 - 20, message, {
				fontFamily: 'monospace',
				fontSize: '52px',
				color
			})
			.setOrigin(0.5);
		this.add
			.text(width / 2, height / 2 + 36, 'Press R to play again', {
				fontFamily: 'monospace',
				fontSize: '22px',
				color: COLORS.text
			})
			.setOrigin(0.5);

		this.input.keyboard.once('keydown-R', () => this.scene.restart());
	}

	gameOver() {
		if (this.isGameOver) return;
		this.isGameOver = true;
		this.fireTimer.remove();
		this.physics.pause();
		this.endText('GAME OVER', '#ef4444');
	}

	win() {
		if (this.isGameOver) return;
		this.isGameOver = true;
		this.fireTimer.remove();
		this.physics.pause();
		this.endText('YOU WIN!', '#4ade80');
	}

	update(time) {
		if (this.isGameOver) return;

		const { height } = this.scale;

		if (Phaser.Input.Keyboard.JustDown(this.dashKey)) {
			this.doDash(time);
		}

		if (Phaser.Input.Keyboard.JustDown(this.timeStopKey)) {
			this.doTimeStop(time);
		}

		// Normal movement — suppressed while dashing
		if (!this.isDashing) {
			const speed = 360;
			if (this.cursors.up.isDown) {
				this.player.setVelocityY(-speed);
			} else if (this.cursors.down.isDown) {
				this.player.setVelocityY(speed);
			} else {
				this.player.setVelocityY(0);
			}
		}

		if (this.fireKey.isDown && time > this.lastFired) {
			this.fireBullet();
			this.lastFired = time + 280;
		}

		// Invaders freeze during time stop
		if (!this.timeStopped) {
			let hitEdge = false;
			const margin = 30;
			const delta = this.game.loop.delta / 1000;
			this.invaders.getChildren().forEach((inv) => {
				inv.y += this.invaderDir * this.invaderSpeed * delta;
				if (inv.y > height - margin || inv.y < margin + 40) hitEdge = true;
			});

			if (hitEdge) {
				this.invaderDir *= -1;
				this.invaders.getChildren().forEach((inv) => {
					inv.x -= 34;
					if (inv.x < this.playerLine) this.gameOver();
				});
				this.invaderSpeed = Math.min(this.invaderSpeed + 8, 160);
			}
		}

		this.cleanupBullets(this.playerBullets);
		this.cleanupBullets(this.invaderBullets);
	}

	cleanupBullets(group) {
		const { width } = this.scale;
		group.getChildren().forEach((b) => {
			if (b.x < -20 || b.x > width + 20) b.destroy();
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
		scene: [MainScene]
	};

	return new Phaser.Game(config);
}
