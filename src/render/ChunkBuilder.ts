import { mat4, vec3 } from 'gl-matrix'
import type { PlacedBlock, Resources, StructureProvider } from '../index.js'
import { BlockPos, Direction, Vector } from '../index.js'
import { radixSortFloat32WithKeys } from '../util/Sort.js'
import { Mesh } from './Mesh.js'
import { SpecialRenderers } from './SpecialRenderer.js'

class Chunk {
  private unmergedMeshList: Mesh[] = []
  private unmergedTransparentMeshList: Mesh[] = []
  private mergedMesh: Mesh | null = null
  private mergedTransparentMesh: Mesh | null = null

  // Store meshes for later; mergedMesh stays intact until getMesh pulls in unmerged.
  public merge(mesh: Mesh, isTransparent: boolean): void {
    if (isTransparent) {
      this.unmergedTransparentMeshList.push(mesh)
    } else {
      this.unmergedMeshList.push(mesh)
    }
  }

  // Lazily fold in any unmerged meshes into the cached mergedMesh.
  public getMesh(): Mesh {
    if (!this.mergedMesh) {
      this.mergedMesh = new Mesh()
    }
    if (this.unmergedMeshList.length > 0) {
      this.mergedMesh.mergeAll(this.unmergedMeshList)
      this.unmergedMeshList = []
    }
    return this.mergedMesh
  }

  // Lazily fold in any unmerged transparent meshes into the cached mergedTransparentMesh.
  public getTransparentMesh(): Mesh {
    if (!this.mergedTransparentMesh) {
      this.mergedTransparentMesh = new Mesh()
    }
    if (this.unmergedTransparentMeshList.length > 0) {
      this.mergedTransparentMesh.mergeAll(this.unmergedTransparentMeshList)
      this.unmergedTransparentMeshList = []
    }
    return this.mergedTransparentMesh
  }

  // Clear everything: both cached merged meshes and any pending unmerged lists.
  public clear(): void {
    this.unmergedMeshList = []
    this.unmergedTransparentMeshList = []
    this.mergedMesh = null
    this.mergedTransparentMesh = null
  }
}


export class ChunkBuilder {
  private chunks: Chunk[][][] = []
  private readonly chunkSize: vec3

  constructor(
    private readonly gl: WebGL2RenderingContext,
    private structure: StructureProvider,
    private readonly resources: Resources,
    chunkSize: number | vec3 = 16
  ) {
    this.chunkSize = typeof chunkSize === 'number'
      ? [chunkSize, chunkSize, chunkSize]
      : chunkSize
    this.updateStructureBuffers()
  }

  public setStructure(structure: StructureProvider) {
    this.structure = structure
    this.updateStructureBuffers()
  }

  public updateStructureBuffers(chunkPositions?: vec3[]): void {
    if (!this.structure) return

    // Clear existing stored meshes
    if (!chunkPositions) {
      this.chunks.forEach(x =>
        x.forEach(y =>
          y.forEach(chunk => {
            chunk.clear()
          })
        )
      )
    } else {
      chunkPositions.forEach(chunkPos => {
        const chunk = this.getChunk(chunkPos)
        chunk.clear()
      })
    }

    // Rebuild: store new meshes rather than merge immediately
    for (const b of this.structure.getBlocks()) {
      if (b.state.isAir()) continue
      const blockName = b.state.getName()
      const blockProps = b.state.getProperties()
      const defaultProps = this.resources.getDefaultBlockProperties(blockName) ?? {}
      Object.entries(defaultProps).forEach(([k, v]) => {
        if (!blockProps[k]) blockProps[k] = v
      })

      const chunkPos: vec3 = [
        Math.floor(b.pos[0] / this.chunkSize[0]),
        Math.floor(b.pos[1] / this.chunkSize[1]),
        Math.floor(b.pos[2] / this.chunkSize[2]),
      ]

      if (chunkPositions &&
        !chunkPositions.some(pos => vec3.equals(pos, chunkPos))
      ) continue

      const chunk = this.getChunk(chunkPos)

      try {
        const blockDefinition = this.resources.getBlockDefinition(blockName)
        const cull = {
          up: this.needsCull(b, Direction.UP),
          down: this.needsCull(b, Direction.DOWN),
          west: this.needsCull(b, Direction.WEST),
          east: this.needsCull(b, Direction.EAST),
          north: this.needsCull(b, Direction.NORTH),
          south: this.needsCull(b, Direction.SOUTH),
        }
        const mesh = new Mesh()
        if (blockDefinition) {
          mesh.merge(blockDefinition.getMesh(
            blockName, blockProps,
            this.resources, this.resources, cull
          ))
        }
        const specialMesh = SpecialRenderers.getBlockMesh(
          b.state, b.nbt, this.resources, cull
        )
        if (!specialMesh.isEmpty()) {
          mesh.merge(specialMesh)
        }
        if (!mesh.isEmpty()) {
          this.finishChunkMesh(mesh, b.pos)
          const flags = this.resources.getBlockFlags(blockName)
          const isTransparent = !!flags?.semi_transparent
          chunk.merge(mesh, isTransparent)
        }
      } catch (e) {
        console.error(`Error rendering block ${blockName}`, e)
      }
    }
  }

  protected sortChunkListByDistance(
		chunkList: Array<{ chunk: Chunk; center: vec3 }>,
		cameraPos: vec3
	): void {
		const n: number = chunkList.length;
		if (n === 0) return;

		const negDistances: Float32Array = new Float32Array(n);
		for (let i: number = 0; i < n; i++) {
			negDistances[i] = -vec3.squaredDistance(chunkList[i].center, cameraPos);
		}

		const {
			sortedValues: _ignored,
			sortedKeys: sortedList,
		}: {
			sortedValues: Float32Array;
			sortedKeys: Array<{ chunk: Chunk; center: vec3 }>;
		} = radixSortFloat32WithKeys(negDistances, chunkList);

		chunkList.length = 0;
		chunkList.push(...sortedList);
	}

  public getTransparentMeshes(cameraPos: vec3): Mesh[] {
    const chunkList: { chunk: Chunk; center: vec3 }[] = []

    for (let i = 0; i < this.chunks.length; i++) {
      if (!this.chunks[i]) continue
      for (let j = 0; j < this.chunks[i].length; j++) {
        if (!this.chunks[i][j]) continue
        for (let k = 0; k < this.chunks[i][j].length; k++) {
          const chunk = this.chunks[i][j][k]
          if (!chunk) continue

          const chunkPosX = (i % 2 === 0) ? i / 2 : -((i - 1) / 2)
          const chunkPosY = (j % 2 === 0) ? j / 2 : -((j - 1) / 2)
          const chunkPosZ = (k % 2 === 0) ? k / 2 : -((k - 1) / 2)
          const center: vec3 = [
            chunkPosX * this.chunkSize[0] + this.chunkSize[0] / 2,
            chunkPosY * this.chunkSize[1] + this.chunkSize[1] / 2,
            chunkPosZ * this.chunkSize[2] + this.chunkSize[2] / 2,
          ]
          chunkList.push({ chunk, center })
        }
      }
    }
		
		this.sortChunkListByDistance(chunkList, cameraPos)

    return chunkList
      .map(item => item.chunk.getTransparentMesh())
      .filter(mesh => !mesh.isEmpty())
  }

  public getNonTransparentMeshes(): Mesh[] {
    return this.chunks.flatMap(x =>
      x.flatMap(y =>
        y.flatMap(chunk => {
          const m = chunk.getMesh()
          return m.isEmpty() ? [] : [m]
        })
      )
    )
  }

  private needsCull(block: PlacedBlock, dir: Direction) {
    const neighbor = this.structure.getBlock(
      BlockPos.towards(block.pos, dir)
    )?.state
    if (!neighbor) return false
    const neighborFlags = this.resources.getBlockFlags(neighbor.getName())

    if (
      block.state.getName().equals(neighbor.getName()) &&
      neighborFlags?.self_culling
    ) {
      return true
    }

    if (neighborFlags?.opaque) {
      return !(dir === Direction.UP && block.state.isWaterlogged())
    } else {
      return (
        block.state.isWaterlogged() && neighbor.isWaterlogged()
      )
    }
  }

  private finishChunkMesh(mesh: Mesh, pos: vec3) {
    const t = mat4.create()
    mat4.translate(t, t, pos)
    mesh.transform(t)

    for (const q of mesh.quads) {
      const normal = q.normal()
      q.forEach(v => (v.normal = normal))
      q.forEach(
        v => (v.blockPos = new Vector(pos[0], pos[1], pos[2]))
      )
    }
  }

  private getChunk(chunkPos: vec3): Chunk {
    const x =
      Math.abs(chunkPos[0]) * 2 +
      (chunkPos[0] < 0 ? 1 : 0)
    const y =
      Math.abs(chunkPos[1]) * 2 +
      (chunkPos[1] < 0 ? 1 : 0)
    const z =
      Math.abs(chunkPos[2]) * 2 +
      (chunkPos[2] < 0 ? 1 : 0)

    if (!this.chunks[x]) this.chunks[x] = []
    if (!this.chunks[x][y]) this.chunks[x][y] = []
    if (!this.chunks[x][y][z]) this.chunks[x][y][z] = new Chunk()

    return this.chunks[x][y][z]
  }
}
