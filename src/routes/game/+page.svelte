<script>
	import { onMount } from 'svelte';

	/** @type {HTMLDivElement} */
	let container;
	/** @type {import('phaser').Game | undefined} */
	let game;

	onMount(() => {
		// Phaser touches `window`, so import it only in the browser.
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

<p class="hint">↑ ↓ move &nbsp;·&nbsp; Space shoot &nbsp;·&nbsp; R restart</p>
<a href="/" class="back">← Home</a>

<style>
	:global(html, body) {
		margin: 0;
		padding: 0;
		overflow: hidden;
		background: #f4f4f5;
	}

	.game {
		position: fixed;
		inset: 0;
		width: 100vw;
		height: 100vh;
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
		color: #18181b;
		text-decoration: none;
		border-bottom: 1px solid transparent;
	}

	.back:hover {
		border-bottom-color: #18181b;
	}
</style>
