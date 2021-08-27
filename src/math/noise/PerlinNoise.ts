import type { Random } from '../random'
import { ImprovedNoise } from './ImprovedNoise'

export class PerlinNoise {
	public readonly noiseLevels: ImprovedNoise[]
	public readonly amplitudes: number[]
	public readonly lowestFreqInputFactor: number
	public readonly lowestFreqValueFactor: number

	constructor(random: Random, firstOctave: number, amplitudes: number[]) {
		if (1 - firstOctave < amplitudes.length) {
			throw new Error('Positive octaves are not allowed')
		}

		this.noiseLevels = Array(amplitudes.length)
		for (let i = -firstOctave; i >= 0; i -= 1) {
			if (i < amplitudes.length && amplitudes[i] !== 0) {
				this.noiseLevels[i] = new ImprovedNoise(random)
			} else {
				random.consume(262)
			}
		}

		this.amplitudes = amplitudes
		this.lowestFreqInputFactor = Math.pow(2, firstOctave)
		this.lowestFreqValueFactor = Math.pow(2, (amplitudes.length - 1)) / (Math.pow(2, amplitudes.length) - 1)
	}

	public sample(x: number, y: number, z: number, yScale = 0, yLimit = 0, fixY = false) {
		let value = 0
		let inputF = this.lowestFreqInputFactor
		let valueF = this.lowestFreqValueFactor
		for (let i = 0; i < this.noiseLevels.length; i += 1) {
			const noise = this.noiseLevels[i]
			if (noise) {
				value += this.amplitudes[i] * valueF * noise.sample(
					PerlinNoise.wrap(x * inputF),
					fixY ? -noise.yo : PerlinNoise.wrap(y * inputF),
					PerlinNoise.wrap(z * inputF),
					yScale * inputF,
					yLimit * inputF,
				)
			}
			inputF *= 2
			valueF /= 2
		}
		return value
	}

	public getOctaveNoise(i: number): ImprovedNoise | undefined {
		return this.noiseLevels[this.noiseLevels.length - 1 - i]
	}

	public static wrap(value: number) {
		return value - Math.floor(value / 3.3554432E7 + 0.5) * 3.3554432E7
	}
}
