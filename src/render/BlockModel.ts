import type { ReadonlyVec3 } from 'gl-matrix'
import { glMatrix, mat4, vec3 } from 'gl-matrix'
import type { Direction } from '../core/index.js'
import { Identifier } from '../core/index.js'
import { Vector } from '../math/index.js'
import type { Color } from '../util/index.js'
import type { ModelVariant } from './BlockDefinition.js'
import type { Cull } from './Cull.js'
import { Mesh } from './Mesh.js'
import { Quad } from './Quad.js'
import type { TextureAtlasProvider, UV } from './TextureAtlas.js'

type Axis = 'x' | 'y' | 'z'

export type Display = 'thirdperson_righthand' | 'thirdperson_lefthand' | 'firstperson_righthand' | 'firstperson_lefthand' | 'gui' | 'head' | 'ground' | 'fixed' | 'none'

type BlockModelFace = {
	texture: string,
	uv?: UV,
	cullface?: Direction,
	rotation?: 0 | 90 | 180 | 270,
	tintindex?: number,
}

type BlockModelElement = {
	from: number[],
	to: number[],
	rotation?: {
		origin: [number, number, number],
		axis: Axis,
		angle: number,
		rescale?: boolean,
	},
	faces?: {
		[key in Direction]?: BlockModelFace
	},
}

type BlockModelDisplay = {
	[key in Display]?: {
		rotation?: [number, number, number],
		translation?: [number, number, number],
		scale?: [number, number, number],
	}
}

type BlockModelGuiLight = 'front' | 'side'

const faceRotations = {
	0: [0, 3, 2, 3, 2, 1, 0, 1],
	90: [2, 3, 2, 1, 0, 1, 0, 3],
	180: [2, 1, 0, 1, 0, 3, 2, 3],
	270: [0, 1, 0, 3, 2, 3, 2, 1],
}

const rotationAxis: {[key in Axis] : ReadonlyVec3} = {
	x: [1, 0, 0],
	y: [0, 1, 0],
	z: [0, 0, 1],
}

const SQRT2 = 1.41421356237

const rescaleAxis: {[key in Axis] : ReadonlyVec3} = {
	x: [1, SQRT2, SQRT2],
	y: [SQRT2, 1, SQRT2],
	z: [SQRT2, SQRT2, 1],
}

export interface BlockModelProvider {
	getBlockModel(id: Identifier): BlockModel | null
}

export class BlockModel {
	private static readonly BUILTIN_GENERATED = Identifier.create('builtin/generated')
	private static readonly GENERATED_LAYERS = ['layer0', 'layer1', 'layer2', 'layer3', 'layer4']
	private generationMarker = false

	constructor(
		private parent: Identifier | undefined,
		private textures: { [key: string]: string } | undefined,
		private elements: BlockModelElement[] | undefined,
		private display?: BlockModelDisplay | undefined,
		private guiLight?: BlockModelGuiLight | undefined,
	) {}

	public getDisplayTransform(display: Display) {
		const transform = this.display?.[display]
		const t = mat4.create()
		mat4.translate(t, t, [8, 8, 8])
		if (transform?.translation) {
			mat4.translate(t, t, transform.translation)
		}
		if (transform?.rotation) {
			mat4.rotateX(t, t, transform.rotation[0] * Math.PI/180)
			mat4.rotateY(t, t, transform.rotation[1] * Math.PI/180)
			mat4.rotateZ(t, t, -transform.rotation[2] * Math.PI/180)
		}
		if (transform?.scale) {
			mat4.scale(t, t, transform.scale)
		}
		mat4.translate(t, t, [-8, -8, -8])
		return t
	}

	public isCube() {
    for (const elements of this.elements ?? []) {
      if (elements.from[0] <= 0.01 && elements.from[1] <= 0.01 && elements.from[2] <= 0.01 &&
          elements.to[0] >= 15.99 && elements.to[1] >= 15.99 && elements.to[2] >= 15.99) {
        return true;
      }
    }
		return false;
	}

	public getMesh(atlas: TextureAtlasProvider, cull: Cull, variant: ModelVariant | undefined, tint?: Color | ((index: number) => Color), textureModifier?: undefined | ((uv: UV, pos: number[], direction: Direction | undefined) => void)) {
		const mesh = new Mesh()
		const getTint = (index?: number): Color => {
			if (tint === undefined) return [1, 1, 1]
			if (index === undefined || index < 0) return [1, 1, 1]
			if (typeof tint === 'function') return tint(index)
			return tint
		}
		for (const e of this.elements ?? []) {
			mesh.merge(this.getElementMesh(e, atlas, cull, variant, getTint, textureModifier))
		}
		return mesh
	}

  private addFace(mesh: Mesh, atlas: TextureAtlasProvider, getTint: (index?: number) => Color, face: BlockModelFace, uv: UV, pos: number[], additionalRotate: number, textureModifier?: undefined | ((uv: UV, pos: number[], direction: Direction | undefined) => void)) {
    if (textureModifier) {
      textureModifier(uv, pos, face.cullface)
    }

    const quad = Quad.fromPoints(
      new Vector(pos[0], pos[1], pos[2]),
      new Vector(pos[3], pos[4], pos[5]),
      new Vector(pos[6], pos[7], pos[8]),
      new Vector(pos[9], pos[10], pos[11]))

    const tint = getTint(face.tintindex)
    quad.setColor(tint)

    const [u0, v0, u1, v1] = atlas.getTextureUV(this.getTexture(face.texture))
    const du = (u1 - u0) / 16
    const dv = (v1 - v0) / 16
    const duu = atlas.getPixelSize() * 0.5
    const dvv = atlas.getPixelSize() * 0.5
    uv[0] = (face.uv?.[0] ?? uv[0]) * du
    uv[1] = (face.uv?.[1] ?? uv[1]) * dv
    uv[2] = (face.uv?.[2] ?? uv[2]) * du
    uv[3] = (face.uv?.[3] ?? uv[3]) * dv
    const newRotation = (
      (( (face.rotation ?? 0) + additionalRotate ) % 360 + 360) % 360
    ) as 0 | 90 | 180 | 270;
    const r = faceRotations[newRotation]
    quad.setTexture([
      u0 + uv[r[0]], v0 + uv[r[1]],
      u0 + uv[r[2]], v0 + uv[r[3]],
      u0 + uv[r[4]], v0 + uv[r[5]],
      u0 + uv[r[6]], v0 + uv[r[7]],
    ], [
      u0 + Math.min(uv[0], uv[2]) + duu,
      v0 + Math.min(uv[1], uv[3]) + dvv,
      u0 + Math.max(uv[0], uv[2]) - duu,
      v0 + Math.max(uv[1], uv[3]) - dvv,
    ])
    mesh.quads.push(quad)
  }

	public getElementMesh(e: BlockModelElement, atlas: TextureAtlasProvider, cull: Cull, variant: ModelVariant | undefined, getTint: (index?: number) => Color, textureModifier?: undefined | ((uv: UV, pos: number[], direction: Direction | undefined) => void)) {
		const mesh = new Mesh()
		const [x0, y0, z0] = e.from
		const [x1, y1, z1] = e.to

		variant = variant ?? {
				model: '',
				uvlock: false,
				x: 0,
				y: 0,
		}

		if (e.faces?.up?.texture && (!e.faces.up.cullface || !cull[e.faces.up.cullface])) {
			this.addFace(mesh, atlas, getTint, e.faces.up, [x0, 16 - z1, x1, 16 - z0],
				[x0, y1, z1,  x1, y1, z1,  x1, y1, z0,  x0, y1, z0], variant.uvlock ? -(variant.y ?? 0) : 0, textureModifier)
		}
		if (e.faces?.down?.texture && (!e.faces.down.cullface || !cull[e.faces.down.cullface])) {
			this.addFace(mesh, atlas, getTint, e.faces.down, [16 - z1, 16 - x1, 16 - z0, 16 - x0],
				[x0, y0, z0,  x1, y0, z0,  x1, y0, z1,  x0, y0, z1], variant.uvlock ? -(variant.y ?? 0) : 0, textureModifier)
		}
		if (e.faces?.south?.texture && (!e.faces.south.cullface || !cull[e.faces.south.cullface])) {
			this.addFace(mesh, atlas, getTint, e.faces.south, [x0, 16 - y1, x1, 16 - y0], 
				[x0, y0, z1,  x1, y0, z1,  x1, y1, z1,  x0, y1, z1], 0, textureModifier)
		}
		if (e.faces?.north?.texture && (!e.faces.north.cullface || !cull[e.faces.north.cullface])) {
			this.addFace(mesh, atlas, getTint, e.faces.north, [16 - x1, 16 - y1, 16 - x0, 16 - y0], 
				[x1, y0, z0,  x0, y0, z0,  x0, y1, z0,  x1, y1, z0], 0, textureModifier)
		}
		if (e.faces?.east?.texture && (!e.faces.east.cullface || !cull[e.faces.east.cullface])) {
			this.addFace(mesh, atlas, getTint, e.faces.east, [16 - z1, 16 - y1, 16 - z0, 16 - y0], 
				[x1, y0, z1,  x1, y0, z0,  x1, y1, z0,  x1, y1, z1], variant.uvlock ? -(variant.x ?? 0) : 0, textureModifier)
		}
		if (e.faces?.west?.texture && (!e.faces.west.cullface || !cull[e.faces.west.cullface])) {
			this.addFace(mesh, atlas, getTint, e.faces.west, [z0, 16 - y1, z1, 16 - y0], 
				[x0, y0, z0,  x0, y0, z1,  x0, y1, z1,  x0, y1, z0], variant.uvlock ? -(variant.x ?? 0) : 0, textureModifier)
		}
	
		const t = mat4.create()
		if (e.rotation) {
			const origin = vec3.fromValues(...e.rotation.origin)
			mat4.translate(t, t, origin)
			mat4.rotate(t, t, glMatrix.toRadian(e.rotation.angle), rotationAxis[e.rotation.axis])
			if (e.rotation.rescale) {
				mat4.scale(t, t, rescaleAxis[e.rotation.axis])
			}
			vec3.negate(origin, origin)
			mat4.translate(t, t, origin)
		}
		return mesh.transform(t)
	}

	public getAllTextureIds(): Identifier[] {
		if (!this.textures) {
			return []
		}
		// TODO: should probably filter out all block unrelated textures like "particle"
		return Object.values(this.textures).map(t => Identifier.parse(t))
	}

	private getTexture(textureRef: string) {
		while (textureRef.startsWith('#')) {
			textureRef = this.textures?.[textureRef.slice(1)] ?? ''
		}
		return Identifier.parse(textureRef)
	}

	public flatten(accessor: BlockModelProvider) {
		if (!this.parent) {
			return
		}
		if (this.parent.equals(BlockModel.BUILTIN_GENERATED)) {
			this.generationMarker = true
			return
		}
		const parent = this.getParent(accessor)
		if (!parent) {
			console.warn(`parent ${this.parent} does not exist!`)
			this.parent = undefined
			return
		}
		parent.flatten(accessor)
		if (!this.elements) {
			this.elements = parent.elements
		}
		if (!this.textures) {
			this.textures = {}
		}
		Object.keys(parent.textures ?? {}).forEach(t => {
			if (!this.textures![t]) {
				this.textures![t] = parent.textures![t]
			}
		})
		if (!this.display) {
			this.display = {}
		}
		Object.keys(parent.display ?? {}).forEach(k => {
			const l = k as Display
			if (!this.display![l]) {
				this.display![l] = parent.display![l]
			} else {
				Object.keys(parent.display![l] ?? {}).forEach(m => {
					const n = m as 'rotation' | 'translation' | 'scale'
					if (!this.display![l]![n]) {
						this.display![l]![n] = parent.display![l]![n]
					}
				})
			}
		})
		if (!this.guiLight) {
			this.guiLight = parent.guiLight
		}
		if (parent.generationMarker) {
			this.generationMarker = true
		}

		if (this.generationMarker && (this.elements?.length ?? 0) === 0) {
			for (let i = 0; i < BlockModel.GENERATED_LAYERS.length; i += 1) {
				const layer = BlockModel.GENERATED_LAYERS[i]
				if (!Object.hasOwn(this.textures, layer)) {
					break
				}
				if (!this.elements) {
					this.elements = []
				}
				this.elements.push({
					from: [0, 0, 0],
					to: [16, 16, 0],
					faces: { south: { texture: `#${layer}`, tintindex: i }},
				})
			}
		}

		this.parent = undefined
	}

	private getParent(accessor: BlockModelProvider) {
		if (!this.parent) return null
		return accessor.getBlockModel(this.parent)
	}

	public static fromJson(data: any) {
		const parent = data.parent === undefined ? undefined : Identifier.parse(data.parent)
		return new BlockModel(parent, data.textures, data.elements, data.display)
	}
}
