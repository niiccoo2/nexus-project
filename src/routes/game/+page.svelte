<script>
	import { onMount } from 'svelte';

	/** @type {HTMLDivElement} */
	let container;
	/** @type {HTMLVideoElement} */
	let cameraEl;
	/** @type {HTMLCanvasElement} */
	let overlayEl;
	/** @type {import('phaser').Game & { controls?: any } | undefined} */
	let game;
	let errorMsg = '';
	let trackerStatus = 'Starting…';
	let handVisible = false;
	let lastGesture = '';
	let lastGestureAt = 0;

	// Skeleton connections — pairs of landmark indices.
	const HAND_CONNECTIONS = [
		[0, 1], [1, 2], [2, 3], [3, 4], // thumb
		[0, 5], [5, 6], [6, 7], [7, 8], // index
		[5, 9], [9, 10], [10, 11], [11, 12], // middle
		[9, 13], [13, 14], [14, 15], [15, 16], // ring
		[13, 17], [17, 18], [18, 19], [19, 20], // pinky
		[0, 17] // palm base
	];

	function dist(a, b) {
		const dx = a.x - b.x;
		const dy = a.y - b.y;
		return Math.sqrt(dx * dx + dy * dy);
	}

	// Robust orientation-independent finger check: a finger is extended when
	// its tip is meaningfully farther from the wrist than the PIP joint.
	function fingerExtended(lm, pip, tip) {
		const wrist = lm[0];
		return dist(wrist, lm[tip]) > dist(wrist, lm[pip]) * 1.1;
	}

	function countFingers(lm) {
		let n = 0;
		if (fingerExtended(lm, 6, 8)) n++;
		if (fingerExtended(lm, 10, 12)) n++;
		if (fingerExtended(lm, 14, 16)) n++;
		if (fingerExtended(lm, 18, 20)) n++;
		// Thumb: tip vs IP, weighted lower (thumb extension is noisy)
		if (dist(lm[0], lm[4]) > dist(lm[0], lm[3]) * 1.15) n++;
		return n;
	}

	function drawHand(ctx, lm, w, h, color) {
		ctx.strokeStyle = color;
		ctx.lineWidth = 2;
		ctx.beginPath();
		for (const [a, b] of HAND_CONNECTIONS) {
			ctx.moveTo(lm[a].x * w, lm[a].y * h);
			ctx.lineTo(lm[b].x * w, lm[b].y * h);
		}
		ctx.stroke();

		ctx.fillStyle = color;
		for (const p of lm) {
			ctx.beginPath();
			ctx.arc(p.x * w, p.y * h, 3, 0, Math.PI * 2);
			ctx.fill();
		}
	}

	function setGesture(label) {
		lastGesture = label;
		lastGestureAt = performance.now();
	}

	onMount(() => {
		let destroyed = false;
		/** @type {any} */
		let handLandmarker = null;
		/** @type {MediaStream | null} */
		let stream = null;
		let rafId = 0;

		const onError = (/** @type {ErrorEvent} */ e) => {
			errorMsg = (e.error?.stack || e.message || String(e.error)) ?? 'Unknown error';
		};
		const onRejection = (/** @type {PromiseRejectionEvent} */ e) => {
			errorMsg = e.reason?.stack || String(e.reason);
		};
		window.addEventListener('error', onError);
		window.addEventListener('unhandledrejection', onRejection);

		(async () => {
			try {
				const { startGame } = await import('$lib/game/SpaceInvaders.js');
				if (destroyed) return;
				game = startGame(container);
			} catch (err) {
				errorMsg = err instanceof Error ? err.stack || err.message : String(err);
				return;
			}

			// Camera — failure here is non-fatal; keyboard still works.
			try {
				trackerStatus = 'Requesting camera…';
				stream = await navigator.mediaDevices.getUserMedia({
					video: { width: 640, height: 480, facingMode: 'user' },
					audio: false
				});
				if (destroyed) {
					stream.getTracks().forEach((t) => t.stop());
					return;
				}
				cameraEl.srcObject = stream;
				await cameraEl.play();
			} catch (err) {
				trackerStatus = 'Camera blocked · keyboard only';
				return;
			}

			try {
				trackerStatus = 'Loading hand tracker…';
				const { FilesetResolver, HandLandmarker } = await import('@mediapipe/tasks-vision');
				if (destroyed) return;

				const vision = await FilesetResolver.forVisionTasks(
					'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm'
				);
				handLandmarker = await HandLandmarker.createFromOptions(vision, {
					baseOptions: {
						modelAssetPath:
							'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
						delegate: 'GPU'
					},
					runningMode: 'VIDEO',
					numHands: 1
				});
				if (destroyed) return;
				trackerStatus = 'Show your hand to the camera';
			} catch (err) {
				trackerStatus = 'Tracker failed · keyboard only';
				return;
			}

			const ctx = overlayEl.getContext('2d');
			let smoothedY = 0.5;
			let lastFistAt = 0;
			let lastOpenAt = 0;
			const ONE_SHOT_COOLDOWN = 700; // ms between same-gesture re-fires
			let lastDetectionTs = -1;

			const loop = () => {
				if (destroyed) return;
				rafId = requestAnimationFrame(loop);

				const vw = cameraEl.videoWidth;
				const vh = cameraEl.videoHeight;
				if (!vw || !vh || cameraEl.readyState < 2) return;

				if (overlayEl.width !== vw) overlayEl.width = vw;
				if (overlayEl.height !== vh) overlayEl.height = vh;
				ctx.clearRect(0, 0, vw, vh);

				const ts = performance.now();
				if (ts === lastDetectionTs) return;
				lastDetectionTs = ts;

				let result;
				try {
					result = handLandmarker.detectForVideo(cameraEl, ts);
				} catch (_) {
					return;
				}

				const ctrl = game?.controls;
				if (!ctrl) return;

				if (result?.landmarks?.length) {
					handVisible = true;
					const lm = result.landmarks[0];

					// Use middle MCP (landmark 9) as palm centre — more stable than tips.
					const palmY = lm[9].y;
					smoothedY = smoothedY * 0.55 + palmY * 0.45;
					ctrl.targetY = smoothedY;

					// Pinch: thumb tip to index tip distance, normalised by hand span.
					const handSpan = dist(lm[0], lm[9]) || 0.1;
					const pinch = dist(lm[4], lm[8]) / handSpan;
					const isPinch = pinch < 0.55;
					ctrl.shoot = isPinch;

					const fingers = countFingers(lm);
					const now = ts;

					// Closed fist (0–1 fingers showing) → time stop
					if (fingers <= 1 && !isPinch && now - lastFistAt > ONE_SHOT_COOLDOWN) {
						ctrl.timeStop = true;
						lastFistAt = now;
						setGesture('✊  Time Stop');
					}
					// Open palm (4–5 fingers extended) → dash
					else if (fingers >= 4 && now - lastOpenAt > ONE_SHOT_COOLDOWN) {
						ctrl.dash = true;
						lastOpenAt = now;
						setGesture('✋  Dash');
					} else if (isPinch) {
						setGesture('🤏  Shoot');
					}

					const skeletonColor = isPinch
						? '#22d3ee'
						: fingers <= 1
							? '#a78bfa'
							: fingers >= 4
								? '#fbbf24'
								: '#60a5fa';
					drawHand(ctx, lm, vw, vh, skeletonColor);

					// Highlight pinch link
					if (isPinch) {
						ctx.strokeStyle = '#22d3ee';
						ctx.lineWidth = 3;
						ctx.beginPath();
						ctx.moveTo(lm[4].x * vw, lm[4].y * vh);
						ctx.lineTo(lm[8].x * vw, lm[8].y * vh);
						ctx.stroke();
					}
				} else {
					handVisible = false;
					ctrl.targetY = null;
					ctrl.shoot = false;
				}

				if (ts - lastGestureAt > 1200) lastGesture = '';
			};
			loop();
		})();

		return () => {
			destroyed = true;
			if (rafId) cancelAnimationFrame(rafId);
			try {
				handLandmarker?.close();
			} catch (_) {
				/* ignore */
			}
			stream?.getTracks().forEach((t) => t.stop());
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

<div class="camera-cutoff" class:active={handVisible}>
	<video class="camera-video" bind:this={cameraEl} autoplay muted playsinline></video>
	<canvas class="camera-overlay" bind:this={overlayEl}></canvas>

	<div class="camera-status">
		<span class="dot" class:on={handVisible}></span>
		<span class="status-text">{handVisible ? 'Tracking' : trackerStatus}</span>
	</div>

	{#if lastGesture}
		<div class="gesture-pill">{lastGesture}</div>
	{/if}
</div>

<div class="cheatsheet">
	<div class="row"><span class="key">Hand ↕</span><span>Move</span></div>
	<div class="row"><span class="key">🤏 Pinch</span><span>Shoot</span></div>
	<div class="row"><span class="key">✋ Open</span><span>Dash</span></div>
	<div class="row"><span class="key">✊ Fist</span><span>Time Stop</span></div>
	<div class="row dim"><span class="key">Keys</span><span>↑↓ Space D T P R</span></div>
</div>

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
		width: 260px;
		height: 195px;
		border: 1px solid rgba(228, 228, 231, 0.18);
		border-radius: 10px;
		background: #09090b;
		overflow: hidden;
		z-index: 10;
		box-shadow: 0 6px 24px rgba(0, 0, 0, 0.5);
		transition:
			border-color 0.25s ease,
			box-shadow 0.25s ease;
	}
	.camera-cutoff.active {
		border-color: #22d3ee;
		box-shadow:
			0 0 0 1px rgba(34, 211, 238, 0.4),
			0 6px 32px rgba(34, 211, 238, 0.25);
	}

	.camera-video,
	.camera-overlay {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: cover;
		transform: scaleX(-1);
	}
	.camera-overlay {
		pointer-events: none;
	}

	.camera-status {
		position: absolute;
		bottom: 6px;
		left: 8px;
		right: 8px;
		display: flex;
		align-items: center;
		gap: 6px;
		font-family: ui-monospace, 'JetBrains Mono', monospace;
		font-size: 11px;
		color: #d4d4d8;
		text-shadow: 0 1px 2px rgba(0, 0, 0, 0.9);
		pointer-events: none;
	}
	.status-text {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: #71717a;
		flex-shrink: 0;
		box-shadow: 0 0 0 0 rgba(34, 211, 238, 0);
		transition: background 0.2s ease;
	}
	.dot.on {
		background: #22d3ee;
		animation: pulse 1.4s ease-in-out infinite;
	}
	@keyframes pulse {
		0%,
		100% {
			box-shadow: 0 0 0 0 rgba(34, 211, 238, 0.5);
		}
		50% {
			box-shadow: 0 0 0 6px rgba(34, 211, 238, 0);
		}
	}

	.gesture-pill {
		position: absolute;
		top: 8px;
		left: 50%;
		transform: translateX(-50%);
		padding: 4px 10px;
		background: rgba(9, 9, 11, 0.85);
		color: #fafafa;
		font-family: ui-monospace, 'JetBrains Mono', monospace;
		font-size: 12px;
		border-radius: 999px;
		border: 1px solid rgba(34, 211, 238, 0.4);
		pointer-events: none;
		white-space: nowrap;
	}

	.cheatsheet {
		position: fixed;
		top: 16px;
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		gap: 14px;
		align-items: center;
		padding: 8px 14px;
		background: rgba(9, 9, 11, 0.72);
		border: 1px solid rgba(228, 228, 231, 0.12);
		border-radius: 999px;
		backdrop-filter: blur(8px);
		-webkit-backdrop-filter: blur(8px);
		font-family: ui-monospace, 'JetBrains Mono', monospace;
		font-size: 12px;
		color: #d4d4d8;
		z-index: 9;
		pointer-events: none;
	}
	.cheatsheet .row {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		white-space: nowrap;
	}
	.cheatsheet .row.dim {
		opacity: 0.6;
		border-left: 1px solid rgba(228, 228, 231, 0.15);
		padding-left: 14px;
	}
	.cheatsheet .key {
		color: #fafafa;
		background: rgba(228, 228, 231, 0.08);
		padding: 2px 7px;
		border-radius: 4px;
		border: 1px solid rgba(228, 228, 231, 0.12);
	}

	.back {
		position: fixed;
		bottom: 12px;
		left: 16px;
		font-family: ui-monospace, monospace;
		color: #71717a;
		text-decoration: none;
		border-bottom: 1px solid transparent;
		z-index: 9;
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
