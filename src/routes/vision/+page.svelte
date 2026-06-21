<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import {
		FilesetResolver,
		GestureRecognizer,
		type GestureRecognizerResult
	} from '@mediapipe/tasks-vision';

	// Component references and state
	let videoElement: HTMLVideoElement | null = null;
	let stream: MediaStream | null = null;
	let animationFrameId: number | null = null;
	let gestureRecognizer: GestureRecognizer | null = null;
	let isLoading = true;

	// Holds the active
	let finalResult: string[] = [];

	onMount(async () => {
		try {
			// 1. Initialize MediaPipe
			const vision = await FilesetResolver.forVisionTasks(
				'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
			);

			gestureRecognizer = await GestureRecognizer.createFromOptions(vision, {
				baseOptions: {
					modelAssetPath:
						'https://storage.googleapis.com/mediapipe-tasks/gesture_recognizer/gesture_recognizer.task'
				},
				numHands: 2,
				runningMode: 'VIDEO'
			});

			// 2. Request and start the webcam stream
			if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
				stream = await navigator.mediaDevices.getUserMedia({
					video: { width: 640, height: 480, facingMode: 'user' },
					audio: false
				});

				if (videoElement) {
					videoElement.srcObject = stream;
					// Wait for metadata to load before starting the loop
					videoElement.onloadedmetadata = () => {
						isLoading = false;
						videoElement?.play();
						startRenderLoop();
					};
				}
			} else {
				alert('Webcam not supported by your browser.');
			}
		} catch (error) {
			console.error('Error initializing camera or MediaPipe:', error);
		}
	});

	function startRenderLoop() {
		let lastVideoTime = -1;

		function renderLoop() {
			// Ensure everything is ready and video has a new frame
			if (videoElement && videoElement.readyState >= 2 && gestureRecognizer) {
				if (videoElement.currentTime !== lastVideoTime) {
					const nowInMs = performance.now();
					const gestureRecognitionResult = gestureRecognizer.recognizeForVideo(
						videoElement,
						nowInMs
					);

					processResult(gestureRecognitionResult);
					lastVideoTime = videoElement.currentTime;
				}
			}
			animationFrameId = requestAnimationFrame(renderLoop);
		}

		renderLoop();
	}

	// 3. Clean up camera track streams alongside the animation loop
	onDestroy(() => {
		if (animationFrameId !== null) {
			cancelAnimationFrame(animationFrameId);
		}
		if (gestureRecognizer) {
			gestureRecognizer.close();
		}
		if (stream) {
			stream.getTracks().forEach((track) => track.stop());
		}
	});

	function processResult(result: GestureRecognizerResult): void {
		// Check if hands exist in the current frame
		if (result.gestures && result.gestures.length > 0) {
			// .map loops through every hand object found (Hand 1, Hand 2, etc.)
			finalResult = result.gestures.map((hand) => {
				// Grab the top-most prediction [0] safely
				return hand[0] ? hand[0].categoryName : 'None';
			});
		} else {
			// Reset array to empty when no hands are in the camera frame
			finalResult = [];
		}
	}
</script>

<main class="video-container">
	{#if isLoading}
		<p>Loading MediaPipe and Camera...</p>
	{/if}

	<video bind:this={videoElement} id="video" autoplay playsinline muted class:hidden={isLoading}>
		<track kind="captions" />
	</video>

	<div class="gestures-display">
		{#each finalResult as gesture, i}
			<p>Hand {i + 1}: <strong>{gesture}</strong></p>
		{:else}
			{#if !isLoading}
				<p>Show your hands to the camera...</p>
			{/if}
		{/each}
	</div>
</main>

<style>
	.video-container {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		font-family: sans-serif;
		gap: 1rem;
	}
	video {
		transform: scaleX(-1); /* Mirrors the camera stream for natural interaction */
		border-radius: 8px;
		background: #000;
	}
	.gestures-display {
		min-height: 60px;
		text-align: center;
	}
	.gestures-display p {
		margin: 0.25rem 0;
		font-size: 1.2rem;
	}
	.hidden {
		display: none;
	}
</style>
