import { mat4 } from 'gl-matrix'
import type { ItemComponentsProvider, ItemStack } from '../core/ItemStack.js'
import { Identifier } from '../core/index.js'
import type { Color } from '../index.js'
import type { BlockModelProvider, Display } from './BlockModel.js'
import type { ItemModelProvider } from './ItemModel.js'
import { Mesh } from './Mesh.js'
import { Renderer } from './Renderer.js'
import type { TextureAtlasProvider } from './TextureAtlas.js'

export interface ItemRendererResources extends BlockModelProvider, TextureAtlasProvider, ItemModelProvider, ItemComponentsProvider {}

export interface ItemRenderingContext {
	display_context?: Display,

	'fishing_rod/cast'?: boolean,
	'bundle/selected_item'?: number,
	selected?: boolean,
	carried?: boolean,
	extended_view?: boolean,
	context_entity_is_view_entity?: boolean,

	keybind_down?: string[],

	main_hand?: 'left' | 'right',
	context_entity_type?: Identifier,
	context_entity_team_color?: Color,
	context_dimension?: Identifier,

	cooldown_percentage?: {[key: string]: number},
	game_time?: number,
	compass_angle?: number,
	use_duration?: number,
	max_use_duration?: number,
	'crossbow/pull'?: number,
}

export class ItemRenderer extends Renderer {
	private mesh!: Mesh
	private readonly atlasTexture: WebGLTexture


	constructor(
		gl: WebGL2RenderingContext,
		private item: ItemStack,
		private readonly resources: ItemRendererResources,
		context: ItemRenderingContext = {},
	) {
		super(gl)
		this.updateMesh(context)
		this.atlasTexture = this.createAtlasTexture(this.resources.getTextureAtlas())
	}

	public setItem(item: ItemStack, context: ItemRenderingContext = {}) {
		this.item = item
		this.updateMesh(context)
	}

	public updateMesh(context: ItemRenderingContext = {}) {
		this.mesh = ItemRenderer.getItemMesh(this.item, this.resources, context)
		this.mesh.computeNormals()
		this.mesh.rebuild(this.gl, { pos: true, color: true, texture: true, normal: true })
	}

	public static getItemMesh(item: ItemStack, resources: ItemRendererResources, context: ItemRenderingContext) {
		const itemModelId = item.getComponent('item_model', resources)?.getAsString()
		if (itemModelId === undefined){
			return new Mesh()
		}

		const itemModel = resources.getItemModel(Identifier.parse(itemModelId))
		if (!itemModel) {
			throw new Error(`Item model ${itemModelId} does not exist (defined by item ${item.toString()})`)
		}

		const mesh = itemModel.getMesh(item, resources, context)

		return mesh

	}

	public drawItem() {
		const viewMatrix = mat4.create()
		mat4.translate(viewMatrix, viewMatrix, [0, 0, -32])

		const projMatrix = mat4.create()
		mat4.ortho(projMatrix, 0, 16, 0, 16, 0.1, 500.0)

		this.setShader(this.shaderProgram)
		this.setTexture(this.atlasTexture, this.resources.getPixelSize?.())
		this.prepareDraw(viewMatrix, projMatrix)
		this.drawMesh(this.mesh, { pos: true, color: true, texture: true, normal: true })
	}
}
