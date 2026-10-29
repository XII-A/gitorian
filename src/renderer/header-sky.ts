// Cloud and glass shader adapted from radiumcoders/23rd.dev. See NOTICE.
import type { SkyPalette } from './header-sky-palette'

const VERT = `
attribute vec2 a_position;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`

/**
 * Volumetric cumulus: rays from the viewer march through a slab of cloud
 * between BASE and TOP. Density is 3D noise shaped by a height profile and
 * cut back to a slow 2D coverage map, so clouds billow with clear sky
 * between them. Sunlight is attenuated
 * toward the sun (Beer-Lambert) and scattered with a two-lobe phase, so
 * edges near the sun glow and thick cores go gray underneath.
 */
const FRAG = `
precision highp float;

uniform vec2 u_resolution;
uniform float u_time;
uniform float u_speed;
uniform float u_coverage;
uniform float u_intensity;
uniform float u_amount;
uniform float u_scale;
uniform float u_variation;
uniform float u_glass;
uniform float u_glassSize;
uniform vec3 u_c1;
uniform vec3 u_c2;
uniform vec3 u_c3;
uniform vec3 u_c4;
uniform vec2 u_mouse;


uniform sampler2D u_noise;

// Cloud slab, in world units above the viewer.
const float BASE = 1.0;
const float TOP = 1.9;
// Past this distance the layer is haze, not clouds.
const float FAR = 34.0;
const int STEPS = 36;
const int LIGHT_STEPS = 3;
// Horizon just inside the bottom edge, like a photo taken from a hill.
const float TILT = 0.46;

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// Value noise from a 256x256 random texture: one lookup per sample.
float noise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return texture2D(u_noise, (i + f + 0.5) / 256.0).x;
}

// 3D value noise: the texture's green channel is red offset by (37, 239),
// so one lookup returns two neighbouring z slices.
float noise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  vec2 uv = i.xy + vec2(37.0, 239.0) * i.z + f.xy;
  vec2 rg = texture2D(u_noise, (uv + 0.5) / 256.0).yx;
  return mix(rg.x, rg.y, f.z);
}

float luma(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

// Henyey-Greenstein, scaled so isotropic scattering is 1.
float phaseHG(float mu, float g) {
  float g2 = g * g;
  return (1.0 - g2) / pow(1.0 + g2 - 2.0 * g * mu, 1.5);
}

// Local coverage: a slow 2D weather map splits the sky into distinct
// clouds with clear gaps between them.
float coverageAt(vec2 xz) {
  float weather = noise2(xz * mix(0.14, 0.32, u_amount) + 13.7);
  float cov = mix(0.22, 0.72, u_coverage);
  return clamp(cov + (weather - 0.5) * mix(1.0, 0.55, u_amount), 0.0, 1.0);
}

// Cumulus density: 3D fbm shaped by a height profile (flat-ish base,
// billowing top), then cut back to the local coverage.
float density(vec3 q, float hf, float cov, float t, float fine) {
  float shape = smoothstep(0.0, 0.14, hf) * (1.0 - smoothstep(0.35, 1.0, hf));
  float n = noise3(q) * 0.52;
  n += noise3(q * 2.03 + 3.1) * 0.27;
  n += noise3(q * 4.07 + 7.7) * 0.14;
  n += fine * noise3(q * 8.3 + 1.9) * 0.1;
  n /= 0.93 + fine * 0.1;
  float d = n * shape;
  d = clamp((d - (1.0 - cov)) / max(cov, 0.05), 0.0, 1.0);
  if (fine > 0.5 && d > 0.0) {
    // Wispy erosion at the rims, rising slowly like convection.
    float e = noise3(q * 6.1 + vec3(0.0, -t * 0.6, 0.0));
    d = clamp(d - e * mix(0.08, 0.26, u_variation) * (1.0 - d), 0.0, 1.0);
  }
  return d;
}

void main() {
  float aspect = u_resolution.x / max(u_resolution.y, 1.0);
  float t = u_time * u_speed;
  float cell = max(u_glassSize, 2.0);

  vec2 uv = gl_FragCoord.xy / u_resolution.xy;
  vec2 glassLocal = fract(gl_FragCoord.xy / cell) - 0.5;
  if (u_glass > 0.5) {
    uv += glassLocal * 0.0032;
  }

  vec2 s = (uv - 0.5) * vec2(aspect, 1.0);
  s += (u_mouse - 0.5) * vec2(0.06, 0.03);
  vec3 dir = normalize(vec3(s.x, s.y + TILT, 1.0));
  vec3 sunDir = normalize(vec3(0.85, 0.95, 1.0));
  float mu = dot(dir, sunDir);

  // Storm palettes (cloud darker than the horizon) mute the sun.
  float storm = 1.0 - smoothstep(-0.12, 0.02, luma(u_c3) - luma(u_c2));
  float sunAmt = 1.0 - storm * 0.75;
  vec3 sunTint = mix(vec3(1.0, 0.96, 0.88), u_c3, 0.3);

  // --- Sky ---------------------------------------------------------------
  // Below the horizon there is only haze.
  float up = clamp(dir.y, 0.0, 1.0);
  vec3 sky = mix(u_c2, u_c1, pow(smoothstep(0.0, 0.85, up), 0.6));
  vec3 haze = mix(u_c2, vec3(1.0), 0.3 * luma(u_c2));
  sky = mix(sky, haze, exp(-up * 9.0) * 0.6);
  float glow = pow(max(mu, 0.0), 8.0) * 0.14 + pow(max(mu, 0.0), 120.0) * 0.3;
  sky += sunTint * glow * sunAmt;

  // --- Clouds ------------------------------------------------------------
  float freq = mix(2.2, 0.9, u_scale);
  // Wind carries the field sideways and toward the viewer.
  vec3 drift = vec3(t * 0.5, 0.0, t * 0.2);
  float sigma = mix(10.0, 26.0, u_intensity);
  vec3 sunLight = u_c3 * mix(1.12, 1.0, storm) * mix(vec3(1.0), sunTint, sunAmt * 0.5);
  float phase = mix(phaseHG(mu, -0.2), phaseHG(mu, 0.7), 0.12);

  vec3 L = vec3(0.0);
  float T = 1.0;
  float hitAt = 0.0;
  if (dir.y > 0.02) {
    float t0 = BASE / dir.y;
    if (t0 < FAR) {
      float t1 = min(TOP / dir.y, t0 + 5.0);
      float dt = (t1 - t0) / float(STEPS);
      // Jitter the start per pixel so the steps don't band.
      float tt = t0 + dt * hash(gl_FragCoord.xy);
      for (int i = 0; i < STEPS; i++) {
        vec3 p = dir * tt;
        vec3 q = p * freq + drift;
        float hf = (p.y - BASE) / (TOP - BASE);
        float cov = coverageAt(q.xz);
        float d = cov > 0.02 ? density(q, hf, cov, t, 1.0) : 0.0;
        if (d > 0.003) {
          if (hitAt == 0.0) hitAt = tt;
          // March toward the sun for self-shadowing.
          float od = 0.0;
          for (int j = 0; j < LIGHT_STEPS; j++) {
            vec3 lp = p + sunDir * (0.05 + float(j) * 0.12);
            float lh = (lp.y - BASE) / (TOP - BASE);
            od += density(lp * freq + drift, lh, cov, t, 0.0);
          }
          od *= 0.12 * sigma * 0.5;
          // Beer-Lambert with a softer tail standing in for multiple scattering.
          float beer = max(exp(-od), exp(-od * 0.25) * 0.6);
          float powder = 1.0 - exp(-d * 5.0);
          vec3 ambient = mix(u_c4 * mix(0.82, 0.62, storm), mix(u_c1, u_c3, 0.6), hf);
          vec3 lum = sunLight * beer * phase * mix(1.0, powder, 0.35) + ambient * 0.72;
          float dT = exp(-d * sigma * dt);
          L += T * (1.0 - dT) * lum;
          T *= dT;
          if (T < 0.02) break;
        }
        tt += dt;
      }
      // Aerial perspective: distant clouds melt into the horizon haze.
      float fog = 1.0 - exp(-max(hitAt, t0) * 0.05);
      L = mix(L, haze * (1.0 - T), fog * 0.85);
    }
  }

  vec3 col = sky * T + L;

  // Lightning, lit from inside the clouds it hits.
  if (u_glass > 0.5) {
    float pane = 1.0 - smoothstep(0.22, 0.50, length(glassLocal));
    col *= mix(0.93, 1.0, pane);
    vec2 hl = glassLocal - vec2(-0.16, 0.18);
    col += exp(-dot(hl, hl) * 55.0) * 0.035;
    col = mix(col, vec3(luma(col)), 0.04);
  }
  col += (hash(gl_FragCoord.xy + fract(u_time) * 91.0) - 0.5) * 0.008;

  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`

/** Soft clouds hide resolution, so cap the canvas to keep the march cheap. */
const MAX_PIXELS = 600_000
const NOISE_SIZE = 256

function hexToRgb(hex: string): [number, number, number] {
    const h = hex.replace('#', '').trim()
    const full =
        h.length === 3
            ? h
                  .split('')
                  .map((c) => c + c)
                  .join('')
            : h.padEnd(6, '0').slice(0, 6)
    const n = Number.parseInt(full, 16)
    if (Number.isNaN(n)) return [0.14, 0.47, 0.78]
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

/**
 * Seeded random texture for the shader's value noise. Green repeats red
 * offset by (37, 239), which lets one lookup serve two 3D noise slices.
 * Seeded so every visit gets the same sky.
 */
function noiseTexels() {
    const size = NOISE_SIZE
    const data = new Uint8Array(size * size * 4)
    let seed = 0x23d
    const rand = () => {
        seed = (seed + 0x6d2b79f5) | 0
        let r = Math.imul(seed ^ (seed >>> 15), 1 | seed)
        r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r
        return ((r ^ (r >>> 14)) >>> 0) / 4294967296
    }
    for (let i = 0; i < size * size; i++) {
        data[i * 4] = Math.floor(rand() * 256)
    }
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const from = ((y - 239) & (size - 1)) * size + ((x - 37) & (size - 1))
            const i = (y * size + x) * 4
            data[i + 1] = data[from * 4]!
            data[i + 2] = 0
            data[i + 3] = 255
        }
    }
    return data
}

function compile(gl: WebGLRenderingContext, type: number, source: string) {
    const shader = gl.createShader(type)
    if (!shader) return null
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        if (import.meta.env.DEV) {
            console.warn('ShaderSky: shader failed to compile\n', gl.getShaderInfoLog(shader))
        }
        gl.deleteShader(shader)
        return null
    }
    return shader
}

export function createHeaderSky(canvas: HTMLCanvasElement, colors: SkyPalette, animated: boolean) {
    const gl = canvas.getContext('webgl', {
        alpha: false,
        antialias: false,
        depth: false,
        stencil: false,
        powerPreference: 'low-power'
    })
    if (!gl) return null
    let vs: WebGLShader | null = null
    let fs: WebGLShader | null = null
    let program: WebGLProgram | null = null
    let buf: WebGLBuffer | null = null
    let noiseTex: WebGLTexture | null = null
    let uResolution: WebGLUniformLocation | null = null
    let uTime: WebGLUniformLocation | null = null
    let uSpeed: WebGLUniformLocation | null = null
    let uCoverage: WebGLUniformLocation | null = null
    let uIntensity: WebGLUniformLocation | null = null
    let uAmount: WebGLUniformLocation | null = null
    let uScale: WebGLUniformLocation | null = null
    let uVariation: WebGLUniformLocation | null = null
    let uGlass: WebGLUniformLocation | null = null
    let uGlassSize: WebGLUniformLocation | null = null
    let uC1: WebGLUniformLocation | null = null
    let uC2: WebGLUniformLocation | null = null
    let uC3: WebGLUniformLocation | null = null
    let uC4: WebGLUniformLocation | null = null
    let uMouse: WebGLUniformLocation | null = null

    // Builds every GL resource; runs at startup and again after a lost context
    // comes back, since a restored context starts empty.
    const initGl = () => {
        vs = compile(gl, gl.VERTEX_SHADER, VERT)
        fs = compile(gl, gl.FRAGMENT_SHADER, FRAG)
        if (!vs || !fs) {
            if (vs) gl.deleteShader(vs)
            if (fs) gl.deleteShader(fs)
            return false
        }

        program = gl.createProgram()
        if (!program) {
            gl.deleteShader(vs)
            gl.deleteShader(fs)
            return false
        }
        gl.attachShader(program, vs)
        gl.attachShader(program, fs)
        gl.linkProgram(program)
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            if (import.meta.env.DEV) {
                console.warn('ShaderSky: program failed to link\n', gl.getProgramInfoLog(program))
            }
            gl.deleteProgram(program)
            gl.deleteShader(vs)
            gl.deleteShader(fs)
            return false
        }
        gl.useProgram(program)

        buf = gl.createBuffer()
        gl.bindBuffer(gl.ARRAY_BUFFER, buf)
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW)
        const loc = gl.getAttribLocation(program, 'a_position')
        gl.enableVertexAttribArray(loc)
        gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)

        noiseTex = gl.createTexture()
        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D, noiseTex)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, NOISE_SIZE, NOISE_SIZE, 0, gl.RGBA, gl.UNSIGNED_BYTE, noiseTexels())
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT)
        gl.uniform1i(gl.getUniformLocation(program, 'u_noise'), 0)

        uResolution = gl.getUniformLocation(program, 'u_resolution')
        uTime = gl.getUniformLocation(program, 'u_time')
        uSpeed = gl.getUniformLocation(program, 'u_speed')
        uCoverage = gl.getUniformLocation(program, 'u_coverage')
        uIntensity = gl.getUniformLocation(program, 'u_intensity')
        uAmount = gl.getUniformLocation(program, 'u_amount')
        uScale = gl.getUniformLocation(program, 'u_scale')
        uVariation = gl.getUniformLocation(program, 'u_variation')
        uGlass = gl.getUniformLocation(program, 'u_glass')
        uGlassSize = gl.getUniformLocation(program, 'u_glassSize')
        uC1 = gl.getUniformLocation(program, 'u_c1')
        uC2 = gl.getUniformLocation(program, 'u_c2')
        uC3 = gl.getUniformLocation(program, 'u_c3')
        uC4 = gl.getUniformLocation(program, 'u_c4')
        uMouse = gl.getUniformLocation(program, 'u_mouse')
        return true
    }
    if (!initGl()) {
        gl.getExtension('WEBGL_lose_context')?.loseContext()
        return null
    }

    let palette = colors.map(hexToRgb)
    let currentColors = colors
    let timer = 0
    let frame = 0
    let destroyed = false
    let active = true
    let degraded = false
    let last = 0
    // A curated frozen frame gives the narrow workspace a softer, continuous cloud band.
    // Keep the same field position across palettes, resizes and route visits.
    let clock = animated ? 0 : 36
    let slowFrames = 0
    let previousDraw = 0
    const root = canvas.parentElement!
    const stop = () => {
        window.clearTimeout(timer)
        cancelAnimationFrame(frame)
        timer = 0
        frame = 0
    }
    const dispose = () => {
        if (destroyed) return
        destroyed = true
        stop()
        resize.disconnect()
        gl.deleteProgram(program)
        gl.deleteShader(vs)
        gl.deleteShader(fs)
        gl.deleteBuffer(buf)
        gl.deleteTexture(noiseTex)
        gl.getExtension('WEBGL_lose_context')?.loseContext()
    }
    const draw = () => {
        frame = 0
        if (destroyed || !active || degraded || gl.isContextLost()) return
        const now = performance.now()
        if (animated && previousDraw && now - previousDraw > 100) slowFrames++
        else slowFrames = Math.max(0, slowFrames - 1)
        previousDraw = now
        if (slowFrames >= 12) {
            degraded = true
            root.dataset.renderer = 'static'
            canvas.style.visibility = 'hidden'
            stop()
            return
        }
        if (animated) clock += Math.min(0.1, (now - (last || now)) / 1000)
        last = now
        const w = root.clientWidth,
            h = root.clientHeight
        const scale = Math.min(window.devicePixelRatio || 1, 1, Math.sqrt(MAX_PIXELS / Math.max(1, w * h)))
        const width = Math.max(1, Math.floor(w * scale)),
            height = Math.max(1, Math.floor(h * scale))
        if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width
            canvas.height = height
            gl.viewport(0, 0, width, height)
        }
        gl.uniform2f(uResolution, width, height)
        gl.uniform1f(uTime, clock)
        gl.uniform1f(uSpeed, 0.18)
        gl.uniform1f(uCoverage, 0.45)
        gl.uniform1f(uIntensity, 0.65)
        gl.uniform1f(uAmount, 0.4)
        gl.uniform1f(uScale, 0.4)
        gl.uniform1f(uVariation, 0.7)
        gl.uniform1f(uGlass, 1)
        gl.uniform1f(uGlassSize, 7 * scale)
        gl.uniform3fv(uC1, palette[0])
        gl.uniform3fv(uC2, palette[1])
        gl.uniform3fv(uC3, palette[2])
        gl.uniform3fv(uC4, palette[3])
        gl.uniform2f(uMouse, 0.5, 0.5)
        gl.drawArrays(gl.TRIANGLES, 0, 6)
        if (!canvas.dataset.ready) canvas.dataset.ready = 'true'
        const renderer = animated ? 'animated' : 'static'
        if (root.dataset.renderer !== renderer) root.dataset.renderer = renderer
        if (animated) {
            timer = window.setTimeout(() => {
                frame = requestAnimationFrame(draw)
            }, 50)
        }
    }
    // A still workspace redraws only when its dimensions or palette actually change.
    const resize = new ResizeObserver(() => {
        if (!animated && active && !destroyed && !frame) frame = requestAnimationFrame(draw)
    })
    if (!animated) resize.observe(root)
    frame = requestAnimationFrame(draw)
    return {
        setActive(next: boolean) {
            if (destroyed || degraded || active === next) return
            active = next
            stop()
            // Paused time must neither advance the clouds nor count as a slow frame.
            last = 0
            previousDraw = 0
            slowFrames = 0
            if (active) frame = requestAnimationFrame(draw)
        },
        setPalette(next: SkyPalette) {
            if (next === currentColors) return
            currentColors = next
            palette = next.map(hexToRgb)
            if (!animated && active && !destroyed && !frame) frame = requestAnimationFrame(draw)
        },
        destroy: dispose
    }
}
