<script>
	import { onMount } from 'svelte';

	/** @type {HTMLDivElement} */
	let container;
	/** @type {HTMLVideoElement} */
	let cameraEl;
	/** @type {HTMLCanvasElement} */
	let overlayEl;
	/** @type {(import('phaser').Game & { controls?: any }) | undefined} */
	let game;
	let errorMsg = '';
	let trackerStatus = 'Starting…';
	let handVisible = false;
	let lastGesture = '';
	let lastGestureAt = 0;
	let fps = 0;

	let shopOpen = false;
	let shopCoins = 0;
	/** @type {Record<string, number>} */
	let shopUpgrades = {};
	/** @type {Record<string, { cost: number, label: string, color: string, desc: string }>} */
	let shopShipItems = {};
	let shopShipBought = false;
	/** @type {Record<string, { costs: number[], label: string, color: string, durations: number[], desc: string }>} */
	let shopUpgradeItems = {};

	function handleBuy(/** @type {string} */ type) {
		game?.controls?.shopCallback?.buy(type);
	}

	function handleCloseShop() {
		shopOpen = false;
		game?.controls?.shopCallback?.close();
	}

	/** @typedef {{ x:number, y:number, z?:number }} LM */

	// Skeleton connections — pairs of landmark indices.
	const HAND_CONNECTIONS = [
		[0, 1], [1, 2], [2, 3], [3, 4],
		[0, 5], [5, 6], [6, 7], [7, 8],
		[5, 9], [9, 10], [10, 11], [11, 12],
		[9, 13], [13, 14], [14, 15], [15, 16],
		[13, 17], [17, 18], [18, 19], [19, 20],
		[0, 17]
	];

	// Map only the middle portion of the camera to the game height so the
	// player doesn't have to reach the edge of the frame to hit a corner.
	const Y_TOP = 0.18;
	const Y_BOTTOM = 0.82;

	// Pinch hysteresis — different enter/exit thresholds avoid flicker at the boundary.
	const PINCH_ENTER = 0.42;
	const PINCH_EXIT = 0.6;

	// One-shot gestures must hold for N frames before firing — kills false positives.
	const STABILITY_FRAMES = 3;
	const ONE_SHOT_COOLDOWN = 650;

	/**
	 * @param {LM} a
	 * @param {LM} b
	 */
	function dist(a, b) {
		const dx = a.x - b.x;
		const dy = a.y - b.y;
		return Math.sqrt(dx * dx + dy * dy);
	}

	/**
	 * Orientation-independent "is this finger extended?" — tip farther
	 * from the wrist than the PIP joint by a comfortable margin.
	 * @param {LM[]} lm @param {number} pip @param {number} tip
	 */
	function fingerExtended(lm, pip, tip) {
		return dist(lm[0], lm[tip]) > dist(lm[0], lm[pip]) * 1.1;
	}

	/** @param {LM[]} lm */
	function countFingers(lm) {
		let n = 0;
		if (fingerExtended(lm, 6, 8)) n++;
		if (fingerExtended(lm, 10, 12)) n++;
		if (fingerExtended(lm, 14, 16)) n++;
		if (fingerExtended(lm, 18, 20)) n++;
		if (dist(lm[0], lm[4]) > dist(lm[0], lm[3]) * 1.15) n++;
		return n;
	}

	/**
	 * @param {CanvasRenderingContext2D} ctx
	 * @param {LM[]} lm
	 * @param {number} w @param {number} h @param {string} color
	 */
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

	/**
	 * 1€ filter — adaptive low-pass that follows fast motion accurately
	 * while killing tremor at rest. Far better than a fixed-α EMA for
	 * pointer-style hand control.
	 */
	class OneEuroFilter {
		constructor(minCutoff = 1.4, beta = 0.04, dCutoff = 1.0) {
			this.minCutoff = minCutoff;
			this.beta = beta;
			this.dCutoff = dCutoff;
			/** @type {number | null} */
			this.xPrev = null;
			this.dxPrev = 0;
			/** @type {number | null} */
			this.tPrev = null;
		}
		/** @param {number} cutoff @param {number} dt */
		alpha(cutoff, dt) {
			const tau = 1 / (2 * Math.PI * cutoff);
			return 1 / (1 + tau / dt);
		}
		/** @param {number} x @param {number} t */
		filter(x, t) {
			if (this.tPrev === null || this.xPrev === null) {
				this.tPrev = t;
				this.xPrev = x;
				return x;
			}
			const dt = Math.max(0.001, (t - this.tPrev) / 1000);
			const dx = (x - this.xPrev) / dt;
			const aD = this.alpha(this.dCutoff, dt);
			const dxHat = aD * dx + (1 - aD) * this.dxPrev;
			const cutoff = this.minCutoff + this.beta * Math.abs(dxHat);
			const a = this.alpha(cutoff, dt);
			const xHat = a * x + (1 - a) * this.xPrev;
			this.xPrev = xHat;
			this.dxPrev = dxHat;
			this.tPrev = t;
			return xHat;
		}
		reset() {
			this.xPrev = null;
			this.dxPrev = 0;
			this.tPrev = null;
		}
	}

	/** @param {string} label */
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
		let vfcId = 0;
		let docHidden = false;

		const onError = (/** @type {ErrorEvent} */ e) => {
			errorMsg = (e.error?.stack || e.message || String(e.error)) ?? 'Unknown error';
		};
		const onRejection = (/** @type {PromiseRejectionEvent} */ e) => {
			errorMsg = e.reason?.stack || String(e.reason);
		};
		const onVis = () => {
			docHidden = document.hidden;
		};
		window.addEventListener('error', onError);
		window.addEventListener('unhandledrejection', onRejection);
		document.addEventListener('visibilitychange', onVis);

		(async () => {
			try {
				const { startGame } = await import('$lib/game/SpaceInvaders.js');
				if (destroyed) return;
				game = startGame(container);
				game.events.on('shop:open', (/** @type {any} */ data) => {
					shopCoins = data.coins;
					shopUpgrades = { ...data.upgrades };
					shopShipItems = data.shipShop;
					shopShipBought = data.shipBought;
					shopUpgradeItems = data.upgradeShop;
					shopOpen = true;
				});
				game.events.on('shop:update', (/** @type {any} */ data) => {
					shopCoins = data.coins;
					shopUpgrades = { ...data.upgrades };
					shopShipBought = data.shipBought;
				});
				game.events.on('shop:close', () => {
					shopOpen = false;
				});
			} catch (err) {
				errorMsg = err instanceof Error ? err.stack || err.message : String(err);
				return;
			}

			try {
				trackerStatus = 'Requesting camera…';
				// Lower resolution = faster inference + lower bandwidth, accuracy
				// difference is negligible for landmark detection at this distance.
				stream = await navigator.mediaDevices.getUserMedia({
					video: {
						width: { ideal: 480 },
						height: { ideal: 360 },
						frameRate: { ideal: 30, max: 60 },
						facingMode: 'user'
					},
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
					numHands: 1,
					minHandDetectionConfidence: 0.6,
					minHandPresenceConfidence: 0.6,
					minTrackingConfidence: 0.55
				});
				if (destroyed) return;
				trackerStatus = 'Show your hand to the camera';
			} catch (err) {
				trackerStatus = 'Tracker failed · keyboard only';
				return;
			}

			const ctx = overlayEl.getContext('2d');
			if (!ctx) return;

			const yFilter = new OneEuroFilter(1.4, 0.045, 1.0);
			let pinchActive = false;
			let fistFrames = 0;
			let openFrames = 0;
			let lastFistAt = 0;
			let lastOpenAt = 0;
			let lastTs = 0;
			let lastInferenceTs = -1;
			let frameCount = 0;
			let fpsAccum = 0;
			let missingFrames = 0;

			/** @param {DOMHighResTimeStamp} ts */
			const processFrame = (ts) => {
				if (destroyed) return;
				const vw = cameraEl.videoWidth;
				const vh = cameraEl.videoHeight;
				if (!vw || !vh || cameraEl.readyState < 2) return;

				if (overlayEl.width !== vw) overlayEl.width = vw;
				if (overlayEl.height !== vh) overlayEl.height = vh;
				ctx.clearRect(0, 0, vw, vh);

				// Don't re-run inference on the same frame timestamp.
				if (ts === lastInferenceTs) return;
				lastInferenceTs = ts;

				let result;
				try {
					result = handLandmarker.detectForVideo(cameraEl, ts);
				} catch (_) {
					return;
				}

				if (lastTs) {
					const dt = ts - lastTs;
					fpsAccum += 1000 / Math.max(1, dt);
					frameCount++;
					if (frameCount >= 15) {
						fps = Math.round(fpsAccum / frameCount);
						frameCount = 0;
						fpsAccum = 0;
					}
				}
				lastTs = ts;

				const ctrl = game?.controls;
				if (!ctrl) return;

				if (result?.landmarks?.length) {
					missingFrames = 0;
					handVisible = true;
					const lm = result.landmarks[0];

					// Y: use middle MCP as palm centre; filter, then remap from the
					// usable middle band of the camera to the full game height.
					const rawY = lm[9].y;
					const filteredY = yFilter.filter(rawY, ts);
					const remapped = (filteredY - Y_TOP) / (Y_BOTTOM - Y_TOP);
					ctrl.targetY = Math.min(1, Math.max(0, remapped));

					// Pinch — normalised by hand span, with hysteresis.
					const handSpan = dist(lm[0], lm[9]) || 0.1;
					const pinchRatio = dist(lm[4], lm[8]) / handSpan;
					if (pinchActive) {
						if (pinchRatio > PINCH_EXIT) pinchActive = false;
					} else {
						if (pinchRatio < PINCH_ENTER) pinchActive = true;
					}
					ctrl.shoot = pinchActive;

					// Static one-shots — must hold for STABILITY_FRAMES.
					const fingers = countFingers(lm);
					const isFist = fingers <= 1 && !pinchActive;
					const isOpen = fingers >= 4;

					if (isFist) fistFrames++;
					else fistFrames = 0;
					if (isOpen) openFrames++;
					else openFrames = 0;

					if (
						fistFrames === STABILITY_FRAMES &&
						ts - lastFistAt > ONE_SHOT_COOLDOWN
					) {
						ctrl.timeStop = true;
						lastFistAt = ts;
						setGesture('✊  Time Stop');
					} else if (
						openFrames === STABILITY_FRAMES &&
						ts - lastOpenAt > ONE_SHOT_COOLDOWN
					) {
						ctrl.dash = true;
						lastOpenAt = ts;
						setGesture('✋  Dash');
					} else if (pinchActive) {
						setGesture('🤏  Shoot');
					}

					const skeletonColor = pinchActive
						? '#22d3ee'
						: isFist
							? '#a78bfa'
							: isOpen
								? '#fbbf24'
								: '#60a5fa';
					drawHand(ctx, lm, vw, vh, skeletonColor);

					if (pinchActive) {
						ctx.strokeStyle = '#22d3ee';
						ctx.lineWidth = 3;
						ctx.beginPath();
						ctx.moveTo(lm[4].x * vw, lm[4].y * vh);
						ctx.lineTo(lm[8].x * vw, lm[8].y * vh);
						ctx.stroke();
					}
				} else {
					// Tolerate 3 missing frames before releasing — smooths over
					// momentary detection drops without going jittery.
					missingFrames++;
					if (missingFrames > 3) {
						if (handVisible) {
							handVisible = false;
							yFilter.reset();
							pinchActive = false;
							fistFrames = 0;
							openFrames = 0;
						}
						ctrl.targetY = null;
						ctrl.shoot = false;
					}
				}

				if (ts - lastGestureAt > 1200) lastGesture = '';
			};

			// Prefer requestVideoFrameCallback — fires exactly when a new
			// camera frame is ready (no duplicate inferences, no idle CPU
			// when the camera is paused).
			const supportsVFC = 'requestVideoFrameCallback' in cameraEl;
			const schedule = () => {
				if (destroyed) return;
				if (docHidden) {
					// Re-poll occasionally instead of burning RAFs while hidden.
					setTimeout(schedule, 250);
					return;
				}
				if (supportsVFC) {
					vfcId = cameraEl.requestVideoFrameCallback((now) => {
						processFrame(now);
						schedule();
					});
				} else {
					rafId = requestAnimationFrame((now) => {
						processFrame(now);
						schedule();
					});
				}
			};
			schedule();
		})();

		return () => {
			destroyed = true;
			if (rafId) cancelAnimationFrame(rafId);
			if (vfcId && 'cancelVideoFrameCallback' in cameraEl) {
				cameraEl.cancelVideoFrameCallback(vfcId);
			}
			try {
				handLandmarker?.close();
			} catch (_) {
				/* ignore */
			}
			stream?.getTracks().forEach((t) => t.stop());
			window.removeEventListener('error', onError);
			window.removeEventListener('unhandledrejection', onRejection);
			document.removeEventListener('visibilitychange', onVis);
			game?.destroy(true);
		};
	});
</script>

<svelte:head>
	<title>Space Invaders</title>
</svelte:head>

<div class="game" bind:this={container}></div>

<!-- Post-processing overlay: CRT scanlines + vignette + subtle chromatic edges. -->
<div class="post-fx" aria-hidden="true"></div>

<div class="camera-cutoff" class:active={handVisible}>
	<video class="camera-video" bind:this={cameraEl} autoplay muted playsinline></video>
	<canvas class="camera-overlay" bind:this={overlayEl}></canvas>

	<div class="camera-status">
		<span class="dot" class:on={handVisible}></span>
		<span class="status-text">{handVisible ? `Tracking · ${fps} fps` : trackerStatus}</span>
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

{#if shopOpen}
	<div class="shop-backdrop">
		<div class="shop-panel">
			<div class="shop-header">
				<div class="shop-title-wrap">
					<span class="shop-title">UPGRADE SHOP</span>
				</div>
				<div class="shop-coins">
					<span class="coin-icon">◈</span>
					<span class="coin-val">{shopCoins}</span>
				</div>
			</div>

			<!-- Ship: one-time per wave -->
			<div class="shop-section">
				<div class="section-header">
					<span class="section-label">SHIP</span>
					<span class="section-badge wave-badge">ONE-TIME / WAVE</span>
				</div>
				<div class="ship-row">
					{#each Object.entries(shopShipItems) as [type, item]}
						{@const bought = type === 'size' ? shopShipBought : false}
						{@const canAfford = !bought && shopCoins >= item.cost}
						<div class="ship-card" class:bought>
							<div class="ship-card-inner">
								<div class="item-icon">🚀</div>
								<div class="item-name" style="color:{item.color}">{item.label}</div>
								<div class="item-desc">{item.desc}</div>
							</div>
							<button
								class="buy-btn"
								class:affordable={canAfford}
								class:bought
								disabled={bought || shopCoins < item.cost}
								on:click={() => handleBuy(type)}
							>
								{bought ? '✓ EQUIPPED' : `◈  ${item.cost}`}
							</button>
						</div>
					{/each}
				</div>
			</div>

			<!-- Permanent upgrades -->
			<div class="shop-section">
				<div class="section-header">
					<span class="section-label">UPGRADES</span>
					<span class="section-badge perm-badge">PERMANENT</span>
				</div>
				<div class="upgrade-row">
					{#each Object.entries(shopUpgradeItems) as [type, item]}
						{@const level = shopUpgrades[type] ?? 0}
						{@const maxed = level >= item.costs.length}
						{@const cost = maxed ? null : item.costs[level]}
						{@const nextDur = maxed ? null : item.durations[level]}
						{@const canAfford = cost != null && shopCoins >= cost}
						<div class="upgrade-card" class:maxed>
							<div class="upgrade-top">
								<span class="item-name" style="color:{item.color}">{item.label}</span>
								<span class="item-dur" style="color:{item.color}">
									{maxed ? `${item.durations[item.durations.length-1]/1000}s MAX` : level === 0 ? `→ ${nextDur/1000}s` : `${item.durations[level-1]/1000}s → ${nextDur/1000}s`}
								</span>
							</div>
							<div class="item-desc">{item.desc}</div>
							<div class="item-levels">
								{#each item.costs as _, i}
									<span class="level-pip" class:filled={i < level} style={i < level ? `background:${item.color};border-color:${item.color}` : ''}></span>
								{/each}
							</div>
							<button
								class="buy-btn"
								class:affordable={canAfford && !maxed}
								disabled={maxed || !canAfford}
								on:click={() => handleBuy(type)}
							>
								{maxed ? 'MAX' : `◈  ${cost}`}
							</button>
						</div>
					{/each}
				</div>
			</div>

			<button class="continue-btn" on:click={handleCloseShop}>
				▶&nbsp; NEXT WAVE
			</button>
		</div>
	</div>
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

	/* Layered post-FX — pointer-events: none so the canvas still catches input. */
	.post-fx {
		position: fixed;
		inset: 0;
		pointer-events: none;
		z-index: 5;
		background:
			/* scanlines */
			repeating-linear-gradient(
				to bottom,
				rgba(0, 0, 0, 0.18) 0px,
				rgba(0, 0, 0, 0.18) 1px,
				transparent 2px,
				transparent 3px
			),
			/* vignette */
			radial-gradient(
				ellipse at center,
				transparent 50%,
				rgba(0, 0, 0, 0.45) 90%,
				rgba(0, 0, 0, 0.75) 100%
			);
		mix-blend-mode: multiply;
	}
	.post-fx::after {
		/* subtle blue/red chromatic glow at the edges */
		content: '';
		position: absolute;
		inset: 0;
		background:
			radial-gradient(ellipse 70% 60% at 20% 50%, rgba(96, 165, 250, 0.08), transparent 60%),
			radial-gradient(ellipse 70% 60% at 80% 50%, rgba(239, 68, 68, 0.06), transparent 60%);
		mix-blend-mode: screen;
	}
	@media (prefers-reduced-motion: reduce) {
		.post-fx {
			background:
				radial-gradient(
					ellipse at center,
					transparent 60%,
					rgba(0, 0, 0, 0.5) 100%
				);
		}
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

	/* ── Shop overlay ── */

	.shop-backdrop {
		position: fixed;
		inset: 0;
		z-index: 60;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(0, 0, 10, 0.72);
		backdrop-filter: blur(20px);
		-webkit-backdrop-filter: blur(20px);
	}

	.shop-panel {
		background: linear-gradient(160deg, rgba(9, 9, 20, 0.98) 0%, rgba(6, 6, 15, 0.98) 100%);
		border: 1px solid rgba(34, 211, 238, 0.22);
		border-radius: 18px;
		padding: 28px 30px 26px;
		width: 520px;
		max-width: 96vw;
		box-shadow:
			0 0 0 1px rgba(34, 211, 238, 0.07),
			0 0 80px rgba(34, 211, 238, 0.08),
			0 28px 64px rgba(0, 0, 0, 0.85);
		font-family: ui-monospace, 'JetBrains Mono', monospace;
	}

	.shop-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 22px;
		padding-bottom: 16px;
		border-bottom: 1px solid rgba(34, 211, 238, 0.12);
	}

	.shop-title-wrap {
		display: flex;
		align-items: center;
		gap: 10px;
	}

	.shop-title {
		font-size: 18px;
		font-weight: bold;
		color: #22d3ee;
		letter-spacing: 0.14em;
		text-shadow: 0 0 18px rgba(34, 211, 238, 0.5);
	}

	.shop-coins {
		display: flex;
		align-items: center;
		gap: 7px;
		padding: 6px 14px;
		background: rgba(251, 191, 36, 0.08);
		border: 1px solid rgba(251, 191, 36, 0.28);
		border-radius: 999px;
	}

	.coin-icon {
		font-size: 14px;
		color: #fbbf24;
	}

	.coin-val {
		font-size: 17px;
		color: #fbbf24;
		font-weight: bold;
	}

	/* Sections */
	.shop-section {
		margin-bottom: 20px;
	}

	.section-header {
		display: flex;
		align-items: center;
		gap: 10px;
		margin-bottom: 12px;
	}

	.section-label {
		font-size: 11px;
		letter-spacing: 0.15em;
		color: #71717a;
		font-weight: bold;
	}

	.section-badge {
		font-size: 9px;
		letter-spacing: 0.1em;
		padding: 2px 8px;
		border-radius: 999px;
		font-weight: bold;
	}

	.wave-badge {
		color: #60a5fa;
		background: rgba(96, 165, 250, 0.1);
		border: 1px solid rgba(96, 165, 250, 0.25);
	}

	.perm-badge {
		color: #a78bfa;
		background: rgba(167, 139, 250, 0.1);
		border: 1px solid rgba(167, 139, 250, 0.25);
	}

	/* Ship row */
	.ship-row {
		display: flex;
		gap: 10px;
	}

	.ship-card {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 14px;
		padding: 14px 16px;
		background: rgba(96, 165, 250, 0.04);
		border: 1px solid rgba(96, 165, 250, 0.15);
		border-radius: 12px;
		transition: border-color 0.2s, background 0.2s;
	}

	.ship-card:not(.bought):hover {
		border-color: rgba(96, 165, 250, 0.35);
		background: rgba(96, 165, 250, 0.07);
	}

	.ship-card.bought {
		border-color: rgba(96, 165, 250, 0.5);
		background: rgba(96, 165, 250, 0.08);
	}

	.ship-card-inner {
		display: flex;
		align-items: center;
		gap: 12px;
	}

	.item-icon {
		font-size: 22px;
		line-height: 1;
	}

	/* Upgrade row */
	.upgrade-row {
		display: flex;
		gap: 10px;
	}

	.upgrade-card {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 14px 14px;
		background: rgba(167, 139, 250, 0.04);
		border: 1px solid rgba(167, 139, 250, 0.15);
		border-radius: 12px;
		transition: border-color 0.2s, background 0.2s;
	}

	.upgrade-card:not(.maxed):hover {
		border-color: rgba(167, 139, 250, 0.35);
		background: rgba(167, 139, 250, 0.07);
	}

	.upgrade-card.maxed {
		opacity: 0.5;
	}

	.upgrade-top {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 8px;
	}

	.item-name {
		font-size: 11px;
		font-weight: bold;
		letter-spacing: 0.08em;
	}

	.item-dur {
		font-size: 10px;
		letter-spacing: 0.05em;
		opacity: 0.85;
	}

	.item-desc {
		font-size: 10px;
		color: #52525b;
		letter-spacing: 0.03em;
	}

	.item-levels {
		display: flex;
		gap: 5px;
		align-items: center;
	}

	.level-pip {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		border: 1px solid rgba(228, 228, 231, 0.2);
		background: transparent;
		transition: background 0.2s, border-color 0.2s;
	}

	/* Buy buttons */
	.buy-btn {
		padding: 8px 16px;
		font-family: ui-monospace, 'JetBrains Mono', monospace;
		font-size: 11px;
		letter-spacing: 0.05em;
		border-radius: 7px;
		border: 1px solid rgba(228, 228, 231, 0.1);
		background: rgba(228, 228, 231, 0.04);
		color: #3f3f46;
		cursor: not-allowed;
		white-space: nowrap;
		transition: background 0.15s, border-color 0.15s;
	}

	.buy-btn.affordable {
		border-color: rgba(251, 191, 36, 0.45);
		color: #fbbf24;
		background: rgba(251, 191, 36, 0.07);
		cursor: pointer;
	}

	.buy-btn.affordable:hover {
		background: rgba(251, 191, 36, 0.16);
	}

	.buy-btn.bought {
		border-color: rgba(96, 165, 250, 0.35);
		color: #60a5fa;
		background: rgba(96, 165, 250, 0.08);
		cursor: default;
	}

	.upgrade-card .buy-btn {
		width: 100%;
		text-align: center;
	}

	.continue-btn {
		display: block;
		width: 100%;
		margin-top: 6px;
		padding: 14px;
		font-family: ui-monospace, 'JetBrains Mono', monospace;
		font-size: 14px;
		letter-spacing: 0.1em;
		border: 1px solid rgba(34, 211, 238, 0.3);
		border-radius: 10px;
		background: rgba(34, 211, 238, 0.06);
		color: #22d3ee;
		cursor: pointer;
		text-shadow: 0 0 12px rgba(34, 211, 238, 0.4);
		transition: background 0.15s, box-shadow 0.15s;
	}

	.continue-btn:hover {
		background: rgba(34, 211, 238, 0.14);
		box-shadow: 0 0 24px rgba(34, 211, 238, 0.15);
	}
</style>
