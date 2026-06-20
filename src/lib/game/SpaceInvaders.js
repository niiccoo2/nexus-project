import Phaser from 'phaser';

const WIDTH = 640;
const HEIGHT = 720;

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

	// Player ship: a little arrow-ish block.
	const ship = scene.make.graphics({ x: 0, y: 0, add: false });
	ship.fillStyle(COLORS.player, 1);
	ship.fillRect(0, 14, 44, 12); // base
	ship.fillRect(16, 4, 12, 14); // turret
	ship.generateTexture('player', 44, 26);
	ship.destroy();

	make('invader', 36, 26, COLORS.invader);
	make('invaderAlt', 36, 26, COLORS.invaderAlt);
	make('playerBullet', 4, 16, COLORS.playerBullet);
	make('invaderBullet', 4, 14, COLORS.invaderBullet);
}

class MainScene extends Phaser.Scene {
	constructor() {
		super('main');
	}

	create() {
		this.score = 0;
		this.lives = 3;
		this.isGameOver = false;
		this.hasWon = false;

		createTextures(this);

		// Player
		this.player = this.physics.add.sprite(WIDTH / 2, HEIGHT - 60, 'player');
		this.player.setCollideWorldBounds(true);

		// Groups
		this.playerBullets = this.physics.add.group();
		this.invaderBullets = this.physics.add.group();
		this.invaders = this.physics.add.group();

		this.spawnInvaders();

		// Invader horizontal movement state
		this.invaderDir = 1; // 1 = right, -1 = left
		this.invaderSpeed = 40;

		// Input
		this.cursors = this.input.keyboard.createCursorKeys();
		this.fireKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
		this.lastFired = 0;

		// HUD
		this.scoreText = this.add.text(16, 12, 'Score: 0', {
			fontFamily: 'monospace',
			fontSize: '20px',
			color: COLORS.text
		});
		this.livesText = this.add.text(WIDTH - 16, 12, 'Lives: 3', {
			fontFamily: 'monospace',
			fontSize: '20px',
			color: COLORS.text
		});
		this.livesText.setOrigin(1, 0);

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
	}

	spawnInvaders() {
		const rows = 4;
		const cols = 8;
		const startX = 90;
		const startY = 90;
		const gapX = 60;
		const gapY = 52;

		for (let r = 0; r < rows; r++) {
			for (let c = 0; c < cols; c++) {
				const key = r % 2 === 0 ? 'invader' : 'invaderAlt';
				const inv = this.invaders.create(startX + c * gapX, startY + r * gapY, key);
				inv.setData('points', (rows - r) * 10);
			}
		}
	}

	fireBullet() {
		const bullet = this.playerBullets.create(this.player.x, this.player.y - 20, 'playerBullet');
		bullet.setVelocityY(-450);
		bullet.body.setAllowGravity(false);
	}

	invaderFire() {
		if (this.isGameOver) return;
		const alive = this.invaders.getChildren().filter((i) => i.active);
		if (alive.length === 0) return;
		const shooter = Phaser.Utils.Array.GetRandom(alive);
		const bullet = this.invaderBullets.create(shooter.x, shooter.y + 20, 'invaderBullet');
		bullet.setVelocityY(220);
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
		this.add
			.text(WIDTH / 2, HEIGHT / 2 - 20, message, {
				fontFamily: 'monospace',
				fontSize: '44px',
				color
			})
			.setOrigin(0.5);
		this.add
			.text(WIDTH / 2, HEIGHT / 2 + 30, 'Press R to play again', {
				fontFamily: 'monospace',
				fontSize: '20px',
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
		this.hasWon = true;
		this.fireTimer.remove();
		this.physics.pause();
		this.endText('YOU WIN!', '#16a34a');
	}

	update(time) {
		if (this.isGameOver) return;

		// Player movement
		const speed = 320;
		if (this.cursors.left.isDown) {
			this.player.setVelocityX(-speed);
		} else if (this.cursors.right.isDown) {
			this.player.setVelocityX(speed);
		} else {
			this.player.setVelocityX(0);
		}

		// Firing (rate limited)
		if (this.fireKey.isDown && time > this.lastFired) {
			this.fireBullet();
			this.lastFired = time + 350;
		}

		// Move invaders as a block; reverse + drop when one hits the edge.
		let hitEdge = false;
		const margin = 24;
		this.invaders.getChildren().forEach((inv) => {
			inv.x += this.invaderDir * this.invaderSpeed * (this.game.loop.delta / 1000);
			if (inv.x > WIDTH - margin || inv.x < margin) {
				hitEdge = true;
			}
		});

		if (hitEdge) {
			this.invaderDir *= -1;
			this.invaders.getChildren().forEach((inv) => {
				inv.y += 24;
				// Reached the player line -> game over
				if (inv.y > HEIGHT - 100) {
					this.gameOver();
				}
			});
			// Speed up a touch as invaders thin out / advance
			this.invaderSpeed = Math.min(this.invaderSpeed + 6, 140);
		}

		// Clean up off-screen bullets
		this.cleanupBullets(this.playerBullets, -20);
		this.cleanupBullets(this.invaderBullets, HEIGHT + 20);
	}

	cleanupBullets(group, bound) {
		group.getChildren().forEach((b) => {
			if (b.y < -20 || b.y > HEIGHT + 20) b.destroy();
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
		width: WIDTH,
		height: HEIGHT,
		parent,
		backgroundColor: COLORS.background,
		physics: {
			default: 'arcade',
			arcade: { gravity: { y: 0 }, debug: false }
		},
		scene: [MainScene]
	};

	return new Phaser.Game(config);
}
