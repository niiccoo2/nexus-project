<script>
	import { onMount } from 'svelte';

	/** @type {HTMLDivElement} */
	let container;
	/** @type {HTMLVideoElement} */
	let cameraEl;
	/** @type {import('phaser').Game | undefined} */
	let game;

	onMount(() => {
		let destroyed = false;
		import('$lib/game/SpaceInvaders.js').then(({ startGame }) => {
			if (destroyed) return;
			game = startGame(container);
		});

		return () => {
			destroyed = true;
			game?.destroy(true);
		};
	});
</script>

<svelte:head>
	<title>Space Invaders</title>
</svelte:head>

<div class="game" bind:this={container}></div>

<!-- Reserved area for a camera feed (wire up later). -->
<div class="camera-cutoff">
	<video class="camera-video" bind:this={cameraEl} autoplay muted playsinline></video>
	<span class="camera-label">Camera</span>
</div>

<p class="hint">↑ ↓ move &nbsp;·&nbsp; Space shoot &nbsp;·&nbsp; D dash &nbsp;·&nbsp; T time stop &nbsp;·&nbsp; R restart</p>
<a href="/" class="back">← Home</a>

<style>
	:global(html, body) {
		margin: 0;
		padding: 0;
		overflow: hidden;
		background: #000000;
	}

	.game {
		position: fixed;
		inset: 0;
		width: 100vw;
		height: 100vh;
	}

	.camera-cutoff {
		position: fixed;
		bottom: 16px;
		right: 16px;
		width: 240px;
		height: 180px;
		border: 2px solid #18181b;
		border-radius: 6px;
		background: #e4e4e7;
		overflow: hidden;
		z-index: 10;
	}

	.camera-video {
		width: 100%;
		height: 100%;
		object-fit: cover;
		transform: scaleX(-1); /* mirror like a selfie cam */
	}

	.camera-label {
		position: absolute;
		bottom: 6px;
		left: 8px;
		font-family: monospace;
		font-size: 12px;
		color: #52525b;
		pointer-events: none;
	}

	.hint {
		position: fixed;
		bottom: 12px;
		left: 50%;
		transform: translateX(-50%);
		margin: 0;
		font-family: monospace;
		color: #52525b;
		pointer-events: none;
	}

	.back {
		position: fixed;
		bottom: 12px;
		left: 16px;
		font-family: monospace;
		color: #71717a;
		text-decoration: none;
		border-bottom: 1px solid transparent;
	}

	.back:hover {
		border-bottom-color: #71717a;
	}
</style>
