<script>
	import { onMount } from 'svelte';

	/** @type {HTMLDivElement} */
	let container;
	/** @type {HTMLVideoElement} */
	let cameraEl;
	/** @type {import('phaser').Game | undefined} */
	let game;
	/** @type {string} */
	let errorMsg = '';

	onMount(() => {
		let destroyed = false;

		// Surface any runtime crash on screen instead of a silent freeze.
		const onError = (/** @type {ErrorEvent} */ e) => {
			errorMsg = (e.error?.stack || e.message || String(e.error)) ?? 'Unknown error';
		};
		const onRejection = (/** @type {PromiseRejectionEvent} */ e) => {
			errorMsg = e.reason?.stack || String(e.reason);
		};
		window.addEventListener('error', onError);
		window.addEventListener('unhandledrejection', onRejection);

		import('$lib/game/SpaceInvaders.js').then(({ startGame }) => {
			if (destroyed) return;
			game = startGame(container);
		});

		return () => {
			destroyed = true;
			window.removeEventListener('error', onError);
			window.removeEventListener('unhandledrejection', onRejection);
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

{#if errorMsg}
	<pre class="error">{errorMsg}</pre>
{/if}

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

	.error {
		position: fixed;
		top: 16px;
		left: 16px;
		max-width: 60vw;
		margin: 0;
		padding: 12px 16px;
		background: rgba(127, 29, 29, 0.95);
		color: #fecaca;
		font-family: monospace;
		font-size: 13px;
		line-height: 1.4;
		white-space: pre-wrap;
		border-radius: 6px;
		z-index: 100;
	}
</style>
