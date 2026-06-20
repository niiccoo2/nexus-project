import Phaser from 'phaser';

// Light-mode palette
const COLORS = {
	background: 0xf4f4f5,
	player: 0x2563eb,
	playerBullet: 0x1d4ed8,
	invader: 0x18181b,
	invaderAlt: 0x52525b,
	invaderBullet: 0xdc2626,
	text: '#18181b'
};

/**
 * Build a few simple textures from rectangles so the game needs no asset files.
 * @param {Phaser.Scene} scene
 */
function createTextures(scene) {
	const make = (key, w, h, color) => {
		const g = scene.make.graphics({ x: 0, y: 0, add: false });
		g.fillStyle(color, 1);
		g.fillRect(0, 0, w, h);
		g.generateTexture(key, w, h);
		g.destroy();
	};

	// Player ship points to the right.
	const ship = scene.make.graphics({ x: 0, y: 0, add: false });
	ship.fillStyle(COLORS.player, 1);
	ship.fillRect(0, 0, 12, 44); // body
	ship.fillRect(8, 16, 14, 12); // nose
	ship.generateTexture('player', 26, 44);
	ship.destroy();

	make('invader', 30, 30, COLORS.invader);
	make('invaderAlt', 30, 30, COLORS.invaderAlt);
	make('playerBullet', 16, 4, COLORS.playerBullet);
	make('invaderBullet', 14, 4, COLORS.invaderBullet);
}

class MainScene extends Phaser.Scene {
	constructor() {
		super('main');
	}

	create() {
		const { width, height } = this.scale;

		this.score = 0;
		this.lives = 3;
		this.isGameOver = false;

		createTextures(this);

		// Player on the left, moves vertically.
		this.player = this.physics.add.sprite(60, height / 2, 'player');
		this.player.setCollideWorldBounds(true);

		// The line invaders must not cross.
		this.playerLine = 120;

		// Groups
		this.playerBullets = this.physics.add.group();
		this.invaderBullets = this.physics.add.group();
		this.invaders = this.physics.add.group();

		this.spawnInvaders();

		// Invader vertical movement state
		this.invaderDir = 1; // 1 = down, -1 = up
		this.invaderSpeed = 50;

		// Input
		this.cursors = this.input.keyboard.createCursorKeys();
		this.fireKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
		this.lastFired = 0;

		// HUD
		// Sits below the top-left camera cutoff (reserved 240x180 area).
		this.scoreText = this.add.text(20, 212, 'Score: 0', {
			fontFamily: 'monospace',
			fontSize: '22px',
			color: COLORS.text
		});
		this.livesText = this.add
			.text(width - 16, 12, 'Lives: 3', {
				fontFamily: 'monospace',
				fontSize: '22px',
				color: COLORS.text
			})
			.setOrigin(1, 0);

		// Collisions
		this.physics.add.overlap(this.playerBullets, this.invaders, this.hitInvader, undefined, this);
		this.physics.add.overlap(this.invaderBullets, this.player, this.hitPlayer, undefined, this);

		// Invader firing timer
		this.fireTimer = this.time.addEvent({
			delay: 800,
			loop: true,
			callback: this.invaderFire,
			callbackScope: this
		});

		// Keep things sane on window resize.
		this.scale.on('resize', this.handleResize, this);
	}

	handleResize(gameSize) {
		if (!this.livesText) return;
		this.livesText.setX(gameSize.width - 16);
	}

	spawnInvaders() {
		const { width, height } = this.scale;
		const rows = 5; // vertical count
		const cols = 6; // horizontal count
		const gapX = 56;
		const gapY = 56;
		const startX = width - 90 - (cols - 1) * gapX;
		const startY = height / 2 - ((rows - 1) * gapY) / 2;

		for (let c = 0; c < cols; c++) {
			for (let r = 0; r < rows; r++) {
				const key = c % 2 === 0 ? 'invader' : 'invaderAlt';
				const inv = this.invaders.create(startX + c * gapX, startY + r * gapY, key);
				inv.setData('points', (cols - c) * 10);
			}
		}
	}

	fireBullet() {
		const bullet = this.playerBullets.create(this.player.x + 24, this.player.y, 'playerBullet');
		bullet.setVelocityX(550);
		bullet.body.setAllowGravity(false);
	}

	invaderFire() {
		if (this.isGameOver) return;
		const alive = this.invaders.getChildren().filter((i) => i.active);
		if (alive.length === 0) return;
		const shooter = Phaser.Utils.Array.GetRandom(alive);
		const bullet = this.invaderBullets.create(shooter.x - 20, shooter.y, 'invaderBullet');
		bullet.setVelocityX(-260);
		bullet.body.setAllowGravity(false);
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

	hitPlayer(player, bullet) {
		bullet.destroy();
		this.lives -= 1;
		this.livesText.setText('Lives: ' + this.lives);
		this.cameras.main.flash(150, 220, 38, 38);
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
		this.endText('GAME OVER', '#dc2626');
	}

	win() {
		if (this.isGameOver) return;
		this.isGameOver = true;
		this.fireTimer.remove();
		this.physics.pause();
		this.endText('YOU WIN!', '#16a34a');
	}

	update(time) {
		if (this.isGameOver) return;

		const { height } = this.scale;

		// Player moves up/down.
		const speed = 360;
		if (this.cursors.up.isDown) {
			this.player.setVelocityY(-speed);
		} else if (this.cursors.down.isDown) {
			this.player.setVelocityY(speed);
		} else {
			this.player.setVelocityY(0);
		}

		// Firing (rate limited)
		if (this.fireKey.isDown && time > this.lastFired) {
			this.fireBullet();
			this.lastFired = time + 320;
		}

		// Invaders march vertically as a block; reverse + step left at top/bottom edge.
		let hitEdge = false;
		const margin = 30;
		const delta = this.game.loop.delta / 1000;
		this.invaders.getChildren().forEach((inv) => {
			inv.y += this.invaderDir * this.invaderSpeed * delta;
			if (inv.y > height - margin || inv.y < margin + 40) {
				hitEdge = true;
			}
		});

		if (hitEdge) {
			this.invaderDir *= -1;
			this.invaders.getChildren().forEach((inv) => {
				inv.x -= 28; // advance toward the player
				if (inv.x < this.playerLine) {
					this.gameOver();
				}
			});
			this.invaderSpeed = Math.min(this.invaderSpeed + 8, 160);
		}

		// Clean up off-screen bullets
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

/**
 * Boot the Phaser game inside the given parent element.
 * @param {HTMLElement} parent
 * @returns {Phaser.Game}
 */
export function startGame(parent) {
	const config = {
		type: Phaser.AUTO,
		parent,
		backgroundColor: COLORS.background,
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
