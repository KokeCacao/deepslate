import { mat4, vec3 } from 'gl-matrix'
import { radixSortFloat32WithKeys } from '../util/Sort.js'
import type { Mesh } from './Mesh.js'
import type { Quad } from './Quad.js'
import { ShaderProgram } from './ShaderProgram.js'

const vsSource = `
  attribute vec4 vertPos;
  attribute vec2 texCoord;
  attribute vec4 texLimit;
  attribute vec3 vertColor;
  attribute vec3 normal;

  uniform mat4 mView;
  uniform mat4 mProj;

  varying highp vec2 vTexCoord;
  varying highp vec4 vTexLimit;
  varying highp vec3 vTintColor;
  varying highp float vLighting;

  void main(void) {
    gl_Position = mProj * mView * vertPos;
    vTexCoord = texCoord;
  	vTexLimit = texLimit;
    vTintColor = vertColor;
    vLighting = normal.y * 0.2 + abs(normal.z) * 0.1 + 0.8;
  }
`

const fsSource = `
  precision highp float;
  varying highp vec2 vTexCoord;
  varying highp vec4 vTexLimit;
  varying highp vec3 vTintColor;
  varying highp float vLighting;

  uniform sampler2D sampler;
  uniform highp float pixelSize;

  void main(void) {
    vec2 clampedCoord = clamp(vTexCoord, vTexLimit.xy, vTexLimit.zw);
		vec4 texColor = texture2D(sampler, clampedCoord);
    gl_FragColor = vec4(texColor.xyz * vTintColor * vLighting, texColor.a);
  }
`

export class Renderer {
  protected readonly shaderProgram: WebGLProgram
  
  private activeShader: WebGLProgram
  private pixelSize: number = 0

  constructor(
    protected readonly gl: WebGL2RenderingContext,
  ) {
    this.shaderProgram = new ShaderProgram(gl, vsSource, fsSource).getProgram()
    this.activeShader = this.shaderProgram
    this.initialize()
  }

  public setViewport(x: number, y: number, width: number, height: number) {
    this.gl.viewport(x, y, width, height)
  }

  protected initialize() {
    this.gl.enable(this.gl.DEPTH_TEST)
    this.gl.depthFunc(this.gl.LESS)

    this.gl.enable(this.gl.BLEND)
    this.gl.blendFuncSeparate(
      this.gl.SRC_ALPHA, // RGB src factor
      this.gl.ONE_MINUS_SRC_ALPHA, // RGB dst factor
      this.gl.ONE, // Alpha src factor: take full αf
      this.gl.ONE_MINUS_SRC_ALPHA // Alpha dst factor
    );

    this.gl.enable(this.gl.CULL_FACE)
    this.gl.cullFace(this.gl.BACK)
  }

  protected setShader(shader: WebGLProgram) {
    this.gl.useProgram(shader)
    this.activeShader = shader
  }

  protected setVertexAttr(name: string, size: number, buffer: WebGLBuffer | null | undefined) {
    if (buffer === undefined) throw new Error(`Expected buffer for ${name}`)
    const location = this.gl.getAttribLocation(this.activeShader, name)
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, buffer)
    this.gl.vertexAttribPointer(location, size, this.gl.FLOAT, false, 0, 0)
    this.gl.enableVertexAttribArray(location)
  }

  protected setUniform(name: string, value: Float32List) {
    const location = this.gl.getUniformLocation(this.activeShader, name)    
    this.gl.uniformMatrix4fv(location, false, value)
  }

  protected setTexture(texture: WebGLTexture, pixelSize?: number) {
    this.gl.activeTexture(this.gl.TEXTURE0)
    this.gl.bindTexture(this.gl.TEXTURE_2D, texture)
    this.pixelSize = pixelSize ?? 0
  }

  protected createAtlasTexture(image: ImageData) {
    // this.saveAllMipLevels(image, './resources/');

    const texture = this.gl.createTexture()!
    this.gl.bindTexture(this.gl.TEXTURE_2D, texture)

    const ext = this.gl.getExtension('EXT_texture_filter_anisotropic')
    || this.gl.getExtension('MOZ_EXT_texture_filter_anisotropic')
    || this.gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic');
    if (ext) {
      this.gl.texParameterf(
        this.gl.TEXTURE_2D,
        ext.TEXTURE_MAX_ANISOTROPY_EXT,
        4  // try 2, 4, 8, or 16 depending on performance/quality balance
      );
    }

    this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, this.gl.RGBA, this.gl.UNSIGNED_BYTE, image)

    // only sample up to mip level 4 because Minecraft block texture usually 16x16 pixels
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_BASE_LEVEL, 0);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAX_LEVEL, 4);

    // linear blend between the two closest mipmap levels, nearest texel in each.
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.NEAREST_MIPMAP_LINEAR)
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.NEAREST)

    this.gl.generateMipmap(this.gl.TEXTURE_2D)

    return texture
  }

  protected prepareDraw(viewMatrix: mat4, projMatrix: mat4) {
    this.setUniform('mView', viewMatrix)
    this.setUniform('mProj', projMatrix)
    const location = this.gl.getUniformLocation(this.activeShader, 'pixelSize')    
    this.gl.uniform1f(location, this.pixelSize)
  }

  protected extractCameraPositionFromView() {
    // should only be used after prepareDraw()
    const viewLocation = this.gl.getUniformLocation(this.activeShader, 'mView')
    if (!viewLocation) {
      throw new Error('Failed to get location of mView uniform')
    }
    const viewMatrixRaw = this.gl.getUniform(this.activeShader, viewLocation)
    // Ensure we have a valid matrix; gl.getUniform returns an array-like object.
    const viewMatrix = mat4.clone(viewMatrixRaw)
    const invView = mat4.create()
    if (!mat4.invert(invView, viewMatrix)) {
      throw new Error('Inverting view matrix failed')
    }
    // Translation components are at indices 12, 13, 14.
    return vec3.fromValues(invView[12], invView[13], invView[14])
  }

  public static computeQuadCenter(quad: Quad) {
    const vertices = quad.vertices() // Array of Vertex objects
    const center = [0, 0, 0]
    for (const v of vertices) {
        const pos = v.pos.components() // [x, y, z]
        center[0] += pos[0]
        center[1] += pos[1]
        center[2] += pos[2]
    }
    center[0] /= vertices.length
    center[1] /= vertices.length
    center[2] /= vertices.length
    return vec3.fromValues(center[0], center[1], center[2])
  }

  public static sortQuadsByDistanceOld(mesh: Mesh, cameraPos: vec3) {
    if (mesh.quadVertices() === 0) return

    mesh.quads.sort((a: Quad, b: Quad) => {
      const centerA = Renderer.computeQuadCenter(a)
      const centerB = Renderer.computeQuadCenter(b)
      const distA = vec3.distance(cameraPos, centerA)
      const distB = vec3.distance(cameraPos, centerB)
      return distB - distA // Sort in descending order (farthest first)
    })
    mesh.setDirty({
      quads: true,
    })
  }


  public static sortQuadsByDistance(mesh: Mesh, cameraPos: vec3) {
    const quads: Quad[] = mesh.quads;
    const n: number = quads.length;
    if (n < 2) return;

    // 1) Compute negated distances so that ascending sort → descending by real distance
    const negDistances: Float32Array = new Float32Array(n);
    for (let i: number = 0; i < n; i++) {
      const center: vec3 = Renderer.computeQuadCenter(quads[i]);
      const d: number = vec3.distance(cameraPos, center);
      negDistances[i] = -d;
    }

    const {
      sortedValues: _sortedNegDistances,
      sortedKeys: sortedQuads,
    }: {
      sortedValues: Float32Array;
      sortedKeys: Quad[];
    } = radixSortFloat32WithKeys(negDistances, quads);

    mesh.quads = sortedQuads;
    mesh.setDirty({ quads: true });
  }


  protected drawMesh(mesh: Mesh, options: { pos?: boolean, color?: boolean, texture?: boolean, normal?: boolean, blockPos?: boolean, sort?: boolean }) {
    // If the mesh is too large, split it into smaller meshes
    const meshes = mesh.split()

    if (options.sort) {
      this.gl.depthMask(true) // Do not draw to depth buffer for transparent meshes
      // the above is to prevent self-occlusion of transparent meshes (Although Minecraft quads, even with stained_glass, does not have such issue)
      for (const m of meshes) {
        // If the mesh is intended for transparent rendering, sort the quads.
        Renderer.sortQuadsByDistance(m, this.extractCameraPositionFromView())
      }
    } else {
      this.gl.depthMask(false) // Do draw to depth buffer for opaque meshes
    }

    // We rebuild mesh only right before we render to avoid multiple rebuild
    // Mesh will keep tracking whether itself is dirty or not to avoid unnecessary rebuild as well
    meshes.forEach(m => m.rebuild(this.gl, {
      pos: options.pos,
      color: options.color,
      texture: options.texture,
      normal: options.normal,
      blockPos: options.blockPos,
    }))

    for (const m of meshes) {
      this.drawMeshInner(m, options)
    }
  }

  protected drawMeshInner(mesh: Mesh, options: { pos?: boolean, color?: boolean, texture?: boolean, normal?: boolean, blockPos?: boolean, sort?: boolean }) {
    if (mesh.quadVertices() > 0) {
      if (options.pos) this.setVertexAttr('vertPos', 3, mesh.posBuffer)
      if (options.color) this.setVertexAttr('vertColor', 3, mesh.colorBuffer)
      if (options.texture) {
        this.setVertexAttr('texCoord', 2, mesh.textureBuffer)
        this.setVertexAttr('texLimit', 4, mesh.textureLimitBuffer)
      }
      if (options.normal) this.setVertexAttr('normal', 3, mesh.normalBuffer)
      if (options.blockPos) this.setVertexAttr('blockPos', 3, mesh.blockPosBuffer)
  
      if (!mesh.indexBuffer) throw new Error('Expected index buffer')
      this.gl.bindBuffer(this.gl.ELEMENT_ARRAY_BUFFER, mesh.indexBuffer)
  
      this.gl.drawElements(this.gl.TRIANGLES, mesh.quadIndices(), this.gl.UNSIGNED_SHORT, 0)
    }

    if (mesh.lineVertices() > 0) {
      if (options.pos) this.setVertexAttr('vertPos', 3, mesh.linePosBuffer)
      if (options.color) this.setVertexAttr('vertColor', 3, mesh.lineColorBuffer)

      this.gl.drawArrays(this.gl.LINES, 0, mesh.lineVertices())
    }
  }
}
