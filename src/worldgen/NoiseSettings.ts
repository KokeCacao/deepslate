export type NoiseSettings = {
	minY: number,
	height: number,
	xzSize: number,
	ySize: number,
	densityFactor: number,
	densityOffset: number,
	sampling: NoiseSamplingSettings,
	topSlide: NoiseSlideSettings,
	bottomSlide: NoiseSlideSettings,
	useSimplexSurfaceNoise: boolean,
	randomDensityOffset: boolean,
	islandNoiseOverride: boolean,
	isAmplified: boolean,
}

export type NoiseSamplingSettings = {
	xzScale: number,
	yScale: number,
	xzFactor: number,
	yFactor: number,
}

export type NoiseSlideSettings = {
	target: number,
	size: number,
	offset: number,
}