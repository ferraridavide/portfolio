// Adapted from the verified vgpu Holographic Card example; see ../README.md.
struct Params {
  resolution: vec2f,
  tilt: vec2f,
  pointer: vec2f,
  hover: f32,
  strength: f32,
  foilType: u32,
}
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var badge: texture_2d<f32>;
@group(0) @binding(2) var linear: sampler;
@group(0) @binding(3) var cubes: texture_2d<f32>;
@group(0) @binding(4) var lattice: texture_2d<f32>;

fn stroke(distance: f32, width: f32, aa: f32) -> f32 {
  return 1.0 - smoothstep(width, width + aa, abs(distance));
}

// Approximate visible wavelengths in micrometers with smooth display RGB responses.
fn wavelengthColor(wavelength: f32) -> vec3f {
  let response = (vec3f(wavelength) - vec3f(0.610, 0.545, 0.460)) / vec3f(0.045, 0.038, 0.032);
  let visible = smoothstep(0.380, 0.410, wavelength) * (1.0 - smoothstep(0.700, 0.780, wavelength));
  return exp(-0.5 * response * response) * visible;
}

// Reflection grating approximation: m * wavelength = d * dot(L + V, across).
// L and V point away from the surface; across is perpendicular to the grooves.
// Based on the diffraction-order model in GPU Gems, chapter 8 (Jos Stam).
fn diffraction(across: vec2f, lightAndView: vec2f, spacing: f32) -> vec3f {
  let pathDifference = spacing * abs(dot(lightAndView, across));
  let along = dot(lightAndView, vec2f(-across.y, across.x));
  // Finite, imperfect groove patches broaden the directional reflection.
  let envelope = exp(-along * along / 0.36);
  var reflected = vec3f(0);
  for (var order = 1; order <= 3; order++) {
    let m = f32(order);
    reflected += wavelengthColor(pathDifference / m) / (m * m);
  }
  return reflected * envelope;
}

// Broad, art-directed pearlescence underneath the finer diffraction detail.
fn pearlColor(phase: f32) -> vec3f {
  return vec3f(0.55, 0.52, 0.64) + vec3f(0.43, 0.40, 0.34)
    * cos(6.2831853 * (phase + vec3f(0.05, 0.38, 0.63)));
}

fn grain(point: vec2f) -> f32 {
  let p = vec2u(abs(point) * 2400.0);
  var n = (p.x * 1597334677u) ^ (p.y * 3812015801u);
  n = (n ^ (n >> 16u)) * 2246822519u;
  return f32(n & 1023u) / 1023.0 - 0.5;
}

fn etchedPhase(p: vec2f) -> f32 {
  // Warp the surface before tracing contours, so their spacing flows in soft waves.
  let warp = vec2f(
    sin(p.y * 7.0 + sin(p.x * 4.0)) * 0.085,
    sin(p.x * 6.0 - p.y * 3.0) * 0.07
  );
  let q = p + warp - vec2f(0.13, 0.08);
  let radius = length(q * vec2f(1.0, 0.76));
  return radius * 142.0 + sin(atan2(q.y, q.x) * 3.0 + radius * 8.0) * 1.7;
}

// Each gray value in the original cube image describes a different facet.
// The black outlines stay recessed while the faces flash at different angles.
fn cubeFoil(mask: f32, p: vec2f, lightAndView: vec2f) -> vec3f {
  let face = smoothstep(0.15, 0.32, mask);
  let top = smoothstep(0.72, 0.9, mask);
  let side = smoothstep(0.48, 0.6, mask);
  let across = normalize(mix(mix(vec2f(-0.866, 0.5), vec2f(0.866, 0.5), side), vec2f(0, -1), top));
  let angle = dot(across, lightAndView);
  let tint = pearlColor(angle * 0.6 + p.y * 0.3 + p.x * 0.12 + top * 0.18);
  let flash = pow(max(0.0, 1.0 - abs(angle - 0.22) * 1.2), 7.0);
  let spectral = diffraction(across, lightAndView, 1.65);
  return face * (tint * (0.2 + flash * 0.65) + spectral * 0.3 + flash * 0.12);
}

// Alternating diagonal engravings turn the original dark/light pixel lattice
// into two foil layers that catch opposite directions of the moving light.
fn latticeFoil(mask: f32, p: vec2f, lightAndView: vec2f) -> vec3f {
  let cell = smoothstep(0.25, 0.72, mask);
  let across = normalize(mix(vec2f(1, 1), vec2f(-1, 1), cell));
  let angle = dot(across, lightAndView);
  let tint = pearlColor(p.x * 0.32 + p.y * 0.4 + angle * 0.6 + cell * 0.38);
  let flash = pow(max(0.0, 1.0 - abs(angle + mix(-0.25, 0.25, cell)) * 1.3), 8.0);
  let spectral = diffraction(across, lightAndView, 1.35);
  return tint * (mix(0.06, 0.3, cell) + flash * 0.65) + spectral * 0.28 + flash * 0.1;
}

@fragment
fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let resolution = max(params.resolution, vec2f(1));
  let screen = (uv - 0.5) * resolution / min(resolution.x, resolution.y) * 2.0;
  let sx = sin(params.tilt.y);
  let cx = cos(params.tilt.y);
  let sy = sin(params.tilt.x);
  let cy = cos(params.tilt.x);
  let right = vec3f(cy, 0, -sy);
  let down = vec3f(sy * sx, cx, cy * sx);
  let normal = cross(right, down);
  let eye = vec3f(0, 0, 4.5);
  let ray = normalize(vec3f(screen, -4.5));
  let hit = eye - ray * (dot(eye, normal) / dot(ray, normal));
  let p = vec2f(dot(hit, right), dot(hit, down));
  let artworkUv = p * 0.5 + 0.5;
  let artwork = textureSampleLevel(badge, linear, clamp(artworkUv, vec2f(0), vec2f(1)), 0.0);
  let inBounds = all(artworkUv >= vec2f(0)) && all(artworkUv <= vec2f(1));
  let alpha = select(0.0, artwork.a, inBounds);

  // The original grazing light, diffraction, and etched foil now follow the PNG.
  let hover = clamp(params.hover, 0.0, 1.0) * params.strength;
  let lightCenter = params.pointer;
  let delta = p - lightCenter;
  let sweepDistance = delta.x * 0.72 + delta.y * 0.52 + sin(p.y * 4.0 + p.x * 3.0) * 0.08;
  let bandDistance = sweepDistance / 0.36;
  let lightBand = exp(-bandDistance * bandDistance);
  let glintDistance = sweepDistance / 0.085;
  let glint = exp(-glintDistance * glintDistance);
  let spotlight = exp(-dot(delta * vec2f(1.05, 0.72), delta * vec2f(1.05, 0.72)) * 2.6);
  let light = lightBand * spotlight * hover;
  let lightDirection = normalize(vec3f(lightCenter, 1.2) - hit);
  let viewDirection = normalize(eye - hit);
  let lightAndView = vec2f(dot(lightDirection + viewDirection, right), dot(lightDirection + viewDirection, down));
  let illumination = max(dot(normal, lightDirection), 0.0) * max(dot(normal, viewDirection), 0.0);
  let noise = grain(p + vec2f(2));
  let contour = etchedPhase(p);
  let dx = dpdx(p);
  let dy = dpdy(p);
  let gradient = vec2f(dpdx(contour) * dy.y - dpdy(contour) * dx.y, dpdy(contour) * dx.x - dpdx(contour) * dy.x);
  let across = gradient / max(length(gradient), 0.00000001);
  let spectral = diffraction(across, lightAndView, 1.65) * illumination;
  let contours = stroke(sin(contour), 0.06, min(fwidth(contour), 1.0));
  let pearlPhase = dot(lightAndView, vec2f(0.48, -0.32)) + p.y * 0.32 + contour * 0.003;
  let pearl = pearlColor(pearlPhase);
  let reveal = hover * (0.06 + 0.24 * spotlight + lightBand * spotlight * 1.15);
  let foil = vec3f(0.12, 0.14, 0.18) + pearl * 0.65 + spectral * 0.12;
  let sparkle = pow(max(noise + 0.5, 0.0), 24.0) * glint * spotlight * hover;

  // Preserve the badge's lettering: color the substrate, then add fine reflections.
  let luminance = dot(artwork.rgb, vec3f(0.2126, 0.7152, 0.0722));
  let substrate = 1.0 - smoothstep(0.65, 0.95, luminance) * 0.8;
  var color = mix(artwork.rgb, artwork.rgb * (0.7 + pearl * 0.6), light * 0.55 * substrate);
  color += (pearl * light * 0.24 + contours * foil * reveal * 0.38) * substrate;
  color += (pearl * 0.5 + vec3f(0.5)) * glint * spotlight * hover * 0.12;
  color += pearl * sparkle * 0.22 + noise * light * 0.025;

  // A subtle displaced echo gives the etched lines the same depth as the example.
  let foilPoint = p - vec2f(0.007, -0.004) - params.tilt * 0.012;
  let foilPhase = etchedPhase(foilPoint);
  let foilLines = stroke(sin(foilPhase), 0.025, min(fwidth(foilPhase), 1.0));
  color += foilLines * (pearl + spectral * 0.2) * reveal * 0.14 * substrate;

  // Match the résumé's 1.4x overlay scale and small counter-moving parallax.
  let foilUv = (artworkUv - 0.5) / 1.4 + 0.5 + params.pointer * 0.012;
  let cubeMask = textureSampleLevel(cubes, linear, foilUv, 0.0).r;
  let latticeMask = textureSampleLevel(lattice, linear, foilUv, 0.0).r;
  if (params.foilType == 1u || params.foilType == 2u) {
    var pattern = cubeFoil(cubeMask, p, lightAndView);
    if (params.foilType == 2u) {
      pattern = latticeFoil(latticeMask, p, lightAndView);
    }
    let exposure = hover * (0.12 + spotlight * 0.48 + lightBand * spotlight * 0.5);
    color = artwork.rgb * (1.0 - exposure * substrate * 0.13);
    color += pattern * exposure * substrate * 0.78;
    color += pearl * glint * spotlight * hover * 0.1;
  }
  if (params.foilType == 3u) {
    let satinPhase = p.x * 0.35 + p.y * 0.55 + dot(lightAndView, vec2f(0.55, -0.35));
    let satin = pearlColor(satinPhase);
    let brush = grain(vec2f(p.x * 0.06, p.y * 1.8) + 2.0);
    let sheen = hover * (spotlight * 0.2 + lightBand * spotlight * 0.7);
    color = mix(artwork.rgb, artwork.rgb * (0.65 + satin * 0.65), sheen * substrate * 0.65);
    color += satin * sheen * substrate * 0.4;
    color += (vec3f(0.35) + satin * 0.25) * glint * spotlight * hover * 0.22;
    color += brush * sheen * substrate * 0.05;
  }
  return vec4f(clamp(color, vec3f(0), vec3f(1)) * alpha, alpha);
}
